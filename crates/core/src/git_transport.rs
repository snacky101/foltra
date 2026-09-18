//! Git plumbing for an app-owned bare repository. No checkout, shell input, or vault writes.
use crate::{Error, Result};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Child, Command, ExitStatus, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

pub(crate) const MAX_FILES: usize = 10_000;
pub(crate) const MAX_BLOB_BYTES: usize = 16 * 1024 * 1024;
pub(crate) const MAX_TOTAL_BYTES: usize = 128 * 1024 * 1024;
const MAX_OBJECT_BYTES: u64 = 256 * 1024 * 1024;
const MAX_LIST_BYTES: usize = 4 * 1024 * 1024;
const TIMEOUT: Duration = Duration::from_secs(60);
const CONFIG: &str = "[core]\n\trepositoryformatversion = 0\n\tfilemode = true\n\tbare = true\n";
const MARKER: &str = "foltra-git-cache-v1\n";

fn invalid(message: &str) -> Error {
    Error::new("git_invalid", message)
}

pub(crate) fn validate_branch(branch: &str) -> Result<()> {
    if branch.is_empty()
        || branch.len() > 200
        || branch.starts_with('-')
        || branch == "HEAD"
        || branch.contains("..")
        || branch.contains("@{")
        || !branch
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"_./-".contains(&c))
        || branch
            .split('/')
            .any(|p| p.is_empty() || p.starts_with('.') || p.ends_with('.') || p.ends_with(".lock"))
    {
        return Err(invalid(
            "Use a valid Git branch name (letters, numbers, /, -, _, .)",
        ));
    }
    Ok(())
}

fn validate_ref(name: &str) -> Result<()> {
    let suffix = name
        .strip_prefix("refs/")
        .ok_or_else(|| invalid("Expected a full Git ref"))?;
    validate_branch(suffix)
}

fn validate_oid(oid: &str) -> Result<()> {
    if ![40, 64].contains(&oid.len()) || !oid.bytes().all(|c| c.is_ascii_hexdigit()) {
        return Err(invalid("Expected a complete Git object ID"));
    }
    Ok(())
}

pub(crate) fn validate_remote(remote: &str) -> Result<()> {
    if remote.is_empty() || remote.len() > 2048 || remote.chars().any(char::is_control) {
        return Err(invalid("Invalid Git remote"));
    }
    if Path::new(remote).is_absolute() {
        return validate_local_remote(Path::new(remote));
    }
    // Keep remote helpers, URL credentials, query strings and shell metacharacters out.
    let url = regex::Regex::new(r"^(https://|ssh://(?:[A-Za-z0-9_][A-Za-z0-9_.-]*@)?)([A-Za-z0-9][A-Za-z0-9.-]*)(?::([0-9]{1,5}))?/([A-Za-z0-9_./~-]+)$").unwrap();
    let scp = regex::Regex::new(r"^git@([A-Za-z0-9][A-Za-z0-9.-]*):([A-Za-z0-9_./~-]+)$").unwrap();
    if let Some(parts) = url.captures(remote) {
        if parts
            .get(3)
            .is_some_and(|p| p.as_str().parse::<u16>().map_or(true, |p| p == 0))
        {
            return Err(invalid("Invalid Git remote port"));
        }
        if parts[2].ends_with('.') || parts[2].contains("..") {
            return Err(invalid("Invalid Git remote host"));
        }
        return Ok(());
    }
    if let Some(parts) = scp.captures(remote) {
        if !parts[1].ends_with('.') && !parts[1].contains("..") && !parts[2].starts_with('-') {
            return Ok(());
        }
    }
    Err(invalid("Use an HTTPS URL without credentials, an SSH URL, git@host:path, or an absolute local bare repository path"))
}

fn regular(path: &Path) -> Result<bool> {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.file_type().is_symlink() => Err(invalid("Git paths must not be symlinks")),
        Ok(meta) => Ok(meta.is_file()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error.into()),
    }
}

fn bounded_file(path: &Path, max: usize) -> Result<Vec<u8>> {
    if !regular(path)? || fs::metadata(path)?.len() > max as u64 {
        return Err(invalid("Invalid Git metadata file"));
    }
    let mut value = Vec::new();
    fs::File::open(path)?
        .take(max as u64 + 1)
        .read_to_end(&mut value)?;
    if value.len() > max {
        return Err(invalid("Git metadata file is too large"));
    }
    Ok(value)
}

fn validate_local_remote(path: &Path) -> Result<()> {
    if fs::symlink_metadata(path)?.file_type().is_symlink() || !path.is_dir() {
        return Err(invalid("Choose a local bare Git repository, not a symlink"));
    }
    let config = bounded_file(&path.join("config"), 64 * 1024)?;
    let config = std::str::from_utf8(&config).map_err(|_| invalid("Invalid Git config"))?;
    // Local transports spawn upload/receive-pack in the destination. Only inert bare
    // configuration is accepted, including no include, filter, alternate or hook settings.
    let mut core = false;
    let mut bare = false;
    for line in config.lines().map(str::trim) {
        if line.is_empty() || line.starts_with('#') || line.starts_with(';') {
            continue;
        }
        if line.starts_with('[') {
            core = line.eq_ignore_ascii_case("[core]");
            if !core {
                return Err(invalid("Local Git remote has unsupported configuration"));
            }
            continue;
        }
        let (key, value) = line
            .split_once('=')
            .ok_or_else(|| invalid("Invalid local Git config"))?;
        let key = key.trim().to_ascii_lowercase();
        let value = value.trim();
        if !core
            || !matches!(
                key.as_str(),
                "repositoryformatversion"
                    | "bare"
                    | "filemode"
                    | "ignorecase"
                    | "precomposeunicode"
                    | "logallrefupdates"
            )
        {
            return Err(invalid(
                "Local Git remote has executable or unsupported configuration",
            ));
        }
        if key == "repositoryformatversion" && value != "0" {
            return Err(invalid(
                "Only standard SHA-1 local Git repositories are supported",
            ));
        }
        if key == "bare" {
            bare = value.eq_ignore_ascii_case("true");
        }
    }
    if !bare || !regular(&path.join("HEAD"))? || !path.join("objects").is_dir() {
        return Err(invalid("Choose an existing bare Git repository"));
    }
    for forbidden in [
        "objects/info/alternates",
        "objects/info/http-alternates",
        "shallow",
        "commondir",
    ] {
        if fs::symlink_metadata(path.join(forbidden)).is_ok() {
            return Err(invalid(
                "Alternate or shallow local Git repositories are not supported",
            ));
        }
    }
    if path.join("hooks").exists() {
        if fs::symlink_metadata(path.join("hooks"))?
            .file_type()
            .is_symlink()
        {
            return Err(invalid("Git hooks must not be symlinks"));
        }
        for entry in fs::read_dir(path.join("hooks"))? {
            let entry = entry?;
            if entry.file_type()?.is_symlink()
                || !entry.file_name().to_string_lossy().ends_with(".sample")
            {
                return Err(invalid("Local Git remotes with hooks are not supported"));
            }
        }
    }
    object_bytes(path)?;
    Ok(())
}

fn validate_path(path: &str) -> Result<()> {
    if path.is_empty()
        || path.len() > 1024
        || path.split('/').count() > 16
        || path.chars().any(|c| c.is_control() || "\\:\"".contains(c))
        || path.split('/').any(|p| {
            p.is_empty()
                || p == "."
                || p == ".."
                || p.eq_ignore_ascii_case(".git")
                || p.ends_with(' ')
                || p.ends_with('.')
        })
    {
        return Err(invalid("Unsafe file path in Git tree"));
    }
    Ok(())
}

fn object_bytes(path: &Path) -> Result<u64> {
    let mut pending = vec![path.join("objects"), path.join("refs"), path.join("logs")];
    let mut total = 0u64;
    let mut entries = 0usize;
    while let Some(directory) = pending.pop() {
        match fs::symlink_metadata(&directory) {
            Ok(meta) if meta.file_type().is_symlink() => {
                return Err(invalid("Git object paths must not be symlinks"))
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(error.into()),
        }
        let children = match fs::read_dir(directory) {
            Ok(children) => children,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(error.into()),
        };
        for entry in children {
            let entry = match entry {
                Ok(entry) => entry,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Err(error) => return Err(error.into()),
            };
            entries += 1;
            if entries > 100_000 {
                return Err(Error::new(
                    "git_limit",
                    "Git object count exceeds the cache limit",
                ));
            }
            // Git renames temporary objects while this watchdog scans them. Read type and
            // size together without following symlinks, and tolerate only vanished entries.
            let meta = match fs::symlink_metadata(entry.path()) {
                Ok(meta) => meta,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Err(error) => return Err(error.into()),
            };
            if meta.file_type().is_symlink() {
                return Err(invalid("Git object paths must not be symlinks"));
            }
            if meta.is_dir() {
                pending.push(entry.path());
            } else if meta.is_file() {
                total = total.saturating_add(meta.len());
            } else {
                return Err(invalid("Unsupported Git object file"));
            }
            if total > MAX_OBJECT_BYTES {
                return Err(Error::new("git_limit", "Git cache exceeds 256 MiB"));
            }
        }
    }
    Ok(total)
}

fn git_command(path: &Path) -> Command {
    // A fixed executable and a fresh environment exclude inherited helpers/config injection.
    #[cfg(unix)]
    let mut command = Command::new("/usr/bin/git");
    #[cfg(not(unix))]
    let mut command = Command::new("git.exe");
    command.env_clear().current_dir(path)
        .env("PATH", "/usr/bin:/bin:/usr/sbin:/sbin")
        .env("LANG", "C").env("LC_ALL", "C")
        .env("GIT_CONFIG_GLOBAL", "/dev/null").env("GIT_CONFIG_SYSTEM", "/dev/null")
        .env("GIT_CONFIG_NOSYSTEM", "1").env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_NO_REPLACE_OBJECTS", "1")
        .env("GIT_SSH_COMMAND", "/usr/bin/ssh -F /dev/null -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=15")
        .env("GIT_SSH_VARIANT", "ssh")
        .arg("--no-pager").arg(format!("--git-dir={}", path.display()));
    for name in ["HOME", "SSH_AUTH_SOCK", "DEVELOPER_DIR"] {
        if let Some(value) = std::env::var_os(name) {
            command.env(name, value);
        }
    }
    for option in [
        "core.hooksPath=/dev/null",
        "core.attributesFile=/dev/null",
        "core.fsmonitor=false",
        "core.autocrlf=false",
        "core.safecrlf=false",
        "core.fsync=committed",
        "credential.helper=",
        "credential.interactive=false",
        "credential.useHttpPath=true",
        "protocol.allow=never",
        "protocol.https.allow=always",
        "protocol.ssh.allow=always",
        "protocol.file.allow=always",
        "http.sslVerify=true",
        "http.followRedirects=false",
        "http.lowSpeedLimit=1024",
        "http.lowSpeedTime=30",
        "fetch.fsckObjects=true",
        "fetch.unpackLimit=0",
        "transfer.fsckObjects=true",
        "receive.fsckObjects=true",
        "receive.maxInputSize=268435456",
        "gc.auto=0",
        "maintenance.auto=false",
        "fetch.writeCommitGraph=false",
        "submodule.recurse=false",
        "commit.gpgSign=false",
        "user.name=Foltra",
        "user.email=sync@foltra.local",
    ] {
        command.arg("-c").arg(option);
    }
    #[cfg(target_os = "macos")]
    command.arg("-c").arg("credential.helper=osxkeychain");
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    command
}

fn stop(child: &mut Child) {
    #[cfg(unix)]
    unsafe {
        extern "C" {
            fn kill(pid: i32, signal: i32) -> i32;
        }
        // The child was placed in its own process group; also stop SSH/helper descendants.
        kill(-(child.id() as i32), 9);
    }
    let _ = child.kill();
    let _ = child.wait();
}

struct Output {
    status: ExitStatus,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
}

fn read_output(
    mut stream: impl Read,
    limit: usize,
    exceeded: Arc<AtomicBool>,
) -> std::io::Result<Vec<u8>> {
    let mut bytes = Vec::new();
    stream
        .by_ref()
        .take(limit as u64 + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() > limit {
        exceeded.store(true, Ordering::Relaxed);
    }
    Ok(bytes)
}

pub(crate) struct GitRepo {
    path: PathBuf,
}

impl GitRepo {
    pub(crate) fn open(path: &Path) -> Result<Self> {
        if !path.is_absolute() {
            return Err(invalid("Managed Git path must be absolute"));
        }
        fs::create_dir_all(
            path.parent()
                .ok_or_else(|| invalid("Invalid managed Git path"))?,
        )?;
        if fs::symlink_metadata(path).is_ok_and(|m| m.file_type().is_symlink()) {
            return Err(invalid("Managed Git repository must not be a symlink"));
        }
        fs::create_dir_all(path)?;
        let repo = Self {
            path: fs::canonicalize(path)?,
        };
        if fs::read_dir(&repo.path)?.next().is_none() {
            repo.checked(
                &[
                    "init",
                    "--bare",
                    "--template=",
                    "--object-format=sha1",
                    "--initial-branch=main",
                ],
                None,
                4096,
            )?;
            fs::write(repo.path.join("config"), CONFIG)?;
            fs::write(repo.path.join("foltra-managed"), MARKER)?;
        }
        if bounded_file(&repo.path.join("foltra-managed"), 128)? != MARKER.as_bytes()
            || bounded_file(&repo.path.join("config"), 4096)? != CONFIG.as_bytes()
        {
            return Err(invalid("Managed Git repository configuration changed"));
        }
        validate_local_remote(&repo.path)?;
        Ok(repo)
    }

    fn run(&self, args: &[&str], input: Option<Vec<u8>>, limit: usize) -> Result<Output> {
        let mut child = git_command(&self.path)
            .args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|error| {
                Error::new("git_unavailable", format!("Git could not start: {error}"))
            })?;
        let exceeded = Arc::new(AtomicBool::new(false));
        let stdout = child.stdout.take().unwrap();
        let stderr = child.stderr.take().unwrap();
        let mut stdin = child.stdin.take().unwrap();
        let flag = exceeded.clone();
        let out = thread::spawn(move || read_output(stdout, limit, flag));
        let flag = exceeded.clone();
        let err = thread::spawn(move || read_output(stderr, 64 * 1024, flag));
        let writer = thread::spawn(move || match input {
            Some(input) => stdin.write_all(&input),
            None => Ok(()),
        });
        let started = Instant::now();
        let mut disk_check = Instant::now();
        let status = loop {
            if exceeded.load(Ordering::Relaxed) {
                stop(&mut child);
                break Err(Error::new("git_limit", "Git output exceeds the size limit"));
            }
            if started.elapsed() > TIMEOUT {
                stop(&mut child);
                break Err(Error::new("git_timeout", "Git operation timed out"));
            }
            if disk_check.elapsed() > Duration::from_millis(100) {
                if let Err(error) = object_bytes(&self.path) {
                    stop(&mut child);
                    break Err(error);
                }
                disk_check = Instant::now();
            }
            match child.try_wait() {
                Ok(Some(status)) => break Ok(status),
                Ok(None) => thread::sleep(Duration::from_millis(10)),
                Err(error) => {
                    stop(&mut child);
                    break Err(error.into());
                }
            }
        };
        // A helper must not keep the pipes alive after the Git parent exits.
        stop(&mut child);
        let write_result = writer
            .join()
            .map_err(|_| invalid("Git input thread failed"))?;
        let stdout = out
            .join()
            .map_err(|_| invalid("Git output thread failed"))??;
        let stderr = err
            .join()
            .map_err(|_| invalid("Git error thread failed"))??;
        let status = status?;
        if exceeded.load(Ordering::Relaxed) {
            return Err(Error::new("git_limit", "Git output exceeds the size limit"));
        }
        object_bytes(&self.path)?;
        if status.success() {
            write_result?;
        }
        Ok(Output {
            status,
            stdout,
            stderr,
        })
    }

    fn checked(&self, args: &[&str], input: Option<Vec<u8>>, limit: usize) -> Result<Vec<u8>> {
        let output = self.run(args, input, limit)?;
        if output.status.success() {
            Ok(output.stdout)
        } else {
            Err(failed(output))
        }
    }

    pub(crate) fn fetch(&self, remote: &str, branch: &str) -> Result<Option<String>> {
        validate_remote(remote)?;
        validate_branch(branch)?;
        let source = format!("refs/heads/{branch}");
        let found = self.run(
            &["ls-remote", "--refs", "--exit-code", "--", remote, &source],
            None,
            4096,
        )?;
        if found.status.code() == Some(2) {
            return Ok(None);
        }
        if !found.status.success() {
            return Err(failed(found));
        }
        let temp = format!("refs/foltra/fetch-{}", uuid::Uuid::new_v4());
        let spec = format!("{source}:{temp}");
        let result = (|| {
            self.checked(
                &[
                    "fetch",
                    "--quiet",
                    "--no-tags",
                    "--no-write-fetch-head",
                    "--no-auto-maintenance",
                    "--recurse-submodules=no",
                    "--refmap=",
                    "--",
                    remote,
                    &spec,
                ],
                None,
                4096,
            )?;
            self.get_ref(&temp)
        })();
        let _ = self.checked(&["update-ref", "-d", &temp], None, 4096);
        result
    }

    pub(crate) fn get_ref(&self, name: &str) -> Result<Option<String>> {
        validate_ref(name)?;
        let target = format!("{name}^{{commit}}");
        let output = self.run(&["rev-parse", "--verify", "--quiet", &target], None, 1024)?;
        if output.status.code() == Some(1) {
            return Ok(None);
        }
        if !output.status.success() {
            return Err(failed(output));
        }
        Ok(Some(object_id(&output.stdout)?))
    }

    pub(crate) fn set_ref(&self, name: &str, oid: &str) -> Result<()> {
        validate_ref(name)?;
        validate_oid(oid)?;
        self.checked(
            &["cat-file", "-e", &format!("{oid}^{{commit}}")],
            None,
            1024,
        )?;
        self.checked(&["update-ref", name, oid], None, 1024)?;
        Ok(())
    }

    pub(crate) fn read_tree(&self, commit: &str) -> Result<BTreeMap<String, Vec<u8>>> {
        validate_oid(commit)?;
        let listing = self.checked(
            &["ls-tree", "-rz", "--long", "--full-tree", commit],
            None,
            MAX_LIST_BYTES,
        )?;
        let mut entries = vec![];
        let mut paths = BTreeSet::new();
        let mut total = 0usize;
        for entry in listing
            .split(|byte| *byte == 0)
            .filter(|entry| !entry.is_empty())
        {
            let entry =
                std::str::from_utf8(entry).map_err(|_| invalid("Git paths must be UTF-8"))?;
            let (metadata, path) = entry
                .split_once('\t')
                .ok_or_else(|| invalid("Invalid Git tree entry"))?;
            validate_path(path)?;
            if !paths.insert(path.to_lowercase()) {
                return Err(invalid("Git paths collide on case-insensitive filesystems"));
            }
            let fields: Vec<&str> = metadata.split_whitespace().collect();
            if fields.len() != 4 || fields[0] != "100644" || fields[1] != "blob" {
                return Err(invalid(
                    "Only regular, non-executable files are allowed in a synced Git tree",
                ));
            }
            validate_oid(fields[2])?;
            let size = fields[3]
                .parse::<usize>()
                .map_err(|_| invalid("Invalid Git blob size"))?;
            total = total.saturating_add(size);
            if size > MAX_BLOB_BYTES || total > MAX_TOTAL_BYTES || entries.len() >= MAX_FILES {
                return Err(Error::new(
                    "git_limit",
                    "Git tree exceeds the file count or size limit",
                ));
            }
            entries.push((path.to_owned(), fields[2].to_owned(), size));
        }
        if entries.is_empty() {
            return Ok(BTreeMap::new());
        }
        let input = entries
            .iter()
            .map(|(_, oid, _)| format!("{oid}\n"))
            .collect::<String>()
            .into_bytes();
        let output = self.checked(
            &["cat-file", "--batch"],
            Some(input),
            total + entries.len() * 128,
        )?;
        let mut cursor = 0;
        let mut files = BTreeMap::new();
        for (path, oid, size) in entries {
            let end = output[cursor..]
                .iter()
                .position(|byte| *byte == b'\n')
                .map(|i| cursor + i)
                .ok_or_else(|| invalid("Truncated Git blob header"))?;
            if output[cursor..end] != format!("{oid} blob {size}").as_bytes()[..]
                || end + 1 + size >= output.len()
                || output[end + 1 + size] != b'\n'
            {
                return Err(invalid("Invalid Git blob response"));
            }
            files.insert(path, output[end + 1..end + 1 + size].to_vec());
            cursor = end + size + 2;
        }
        if cursor != output.len() {
            return Err(invalid("Unexpected Git blob output"));
        }
        Ok(files)
    }

    pub(crate) fn commit(
        &self,
        files: &BTreeMap<String, Vec<u8>>,
        parents: &[String],
        message: &str,
    ) -> Result<String> {
        if parents.len() > 2 || message.len() > 4096 || message.contains('\0') {
            return Err(invalid("Invalid sync commit metadata"));
        }
        for parent in parents {
            validate_oid(parent)?;
        }
        let mut total = 0usize;
        let mut paths = BTreeSet::new();
        for (path, bytes) in files {
            validate_path(path)?;
            total = total.saturating_add(bytes.len());
            if !paths.insert(path.to_lowercase()) {
                return Err(invalid("Conflicting Git file paths"));
            }
            if files.len() > MAX_FILES || bytes.len() > MAX_BLOB_BYTES || total > MAX_TOTAL_BYTES {
                return Err(Error::new(
                    "git_limit",
                    "Sync snapshot exceeds the file count or size limit",
                ));
            }
        }
        let temporary = format!("refs/foltra/import-{}", uuid::Uuid::new_v4());
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|_| invalid("Invalid system time"))?
            .as_secs();
        let mut input = format!("commit {temporary}\ncommitter Foltra <sync@foltra.local> {now} +0000\ndata {}\n{message}\n", message.len()).into_bytes();
        for (i, parent) in parents.iter().enumerate() {
            input.extend_from_slice(
                format!("{} {parent}\n", if i == 0 { "from" } else { "merge" }).as_bytes(),
            );
        }
        input.extend_from_slice(b"deleteall\n");
        for (path, bytes) in files {
            input.extend_from_slice(
                format!("M 100644 inline \"{path}\"\ndata {}\n", bytes.len()).as_bytes(),
            );
            input.extend_from_slice(bytes);
            input.push(b'\n');
        }
        input.extend_from_slice(b"\ndone\n");
        let result = (|| {
            self.checked(&["fast-import", "--quiet", "--done"], Some(input), 4096)?;
            self.get_ref(&temporary)?
                .ok_or_else(|| invalid("Git did not create the sync commit"))
        })();
        let _ = self.checked(&["update-ref", "-d", &temporary], None, 4096);
        result
    }

    pub(crate) fn merge_base(&self, a: &str, b: &str) -> Result<Option<String>> {
        validate_oid(a)?;
        validate_oid(b)?;
        let output = self.run(&["merge-base", a, b], None, 1024)?;
        if output.status.code() == Some(1) {
            return Ok(None);
        }
        if !output.status.success() {
            return Err(failed(output));
        }
        Ok(Some(object_id(&output.stdout)?))
    }

    pub(crate) fn push(&self, remote: &str, branch: &str, oid: &str) -> Result<()> {
        validate_remote(remote)?;
        validate_branch(branch)?;
        validate_oid(oid)?;
        let spec = format!("{oid}:refs/heads/{branch}");
        self.checked(
            &[
                "push",
                "--porcelain",
                "--no-verify",
                "--recurse-submodules=no",
                "--",
                remote,
                &spec,
            ],
            None,
            16 * 1024,
        )?;
        Ok(())
    }
}

fn object_id(bytes: &[u8]) -> Result<String> {
    let value = std::str::from_utf8(bytes)
        .map_err(|_| invalid("Invalid Git object ID"))?
        .trim();
    validate_oid(value)?;
    Ok(value.to_owned())
}

fn failed(output: Output) -> Error {
    let message: String = String::from_utf8_lossy(&output.stderr)
        .chars()
        .filter(|c| !c.is_control() || *c == '\n')
        .take(1500)
        .collect();
    Error::new(
        "git_failed",
        if message.trim().is_empty() {
            "Git operation failed".to_owned()
        } else {
            message.trim().to_owned()
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repo(dir: &tempfile::TempDir, name: &str) -> GitRepo {
        GitRepo::open(&dir.path().join(name)).unwrap()
    }

    fn files(body: &[u8]) -> BTreeMap<String, Vec<u8>> {
        BTreeMap::from([
            ("notes/example.md".into(), body.to_vec()),
            ("attachments/image.png".into(), vec![0, 255, b'\n', 128]),
        ])
    }

    #[test]
    fn local_bare_roundtrip_keeps_raw_text_binary_and_commit_ancestry() {
        let dir = tempfile::tempdir().unwrap();
        let remote = repo(&dir, "remote");
        let local = repo(&dir, "local");
        let other = repo(&dir, "other");
        let remote_path = remote.path.to_str().unwrap();
        assert_eq!(local.fetch(remote_path, "main").unwrap(), None);
        let original = files("한글  \r\n\n- [b] untouched".as_bytes());
        let first = local
            .commit(&original, &[], "Initial\ncommit refs/heads/evil\n")
            .unwrap();
        assert_eq!(local.read_tree(&first).unwrap(), original);
        assert_eq!(local.get_ref("refs/heads/evil").unwrap(), None);
        local.set_ref("refs/foltra/checkpoint", &first).unwrap();
        local.push(remote_path, "main", &first).unwrap();
        let received = other.fetch(remote_path, "main").unwrap().unwrap();
        assert_eq!(received, first);
        assert_eq!(other.read_tree(&received).unwrap(), original);
        let next = other
            .commit(&files(b"Edited"), std::slice::from_ref(&received), "Second")
            .unwrap();
        assert_eq!(other.merge_base(&received, &next).unwrap(), Some(received));
        other.push(remote_path, "main", &next).unwrap();
        assert_eq!(
            local.fetch(remote_path, "main").unwrap(),
            Some(next.clone())
        );
        assert_eq!(local.read_tree(&next).unwrap(), files(b"Edited"));
        assert_eq!(
            GitRepo::open(&local.path)
                .unwrap()
                .get_ref("refs/foltra/checkpoint")
                .unwrap(),
            Some(first)
        );
    }

    #[test]
    fn diverged_push_does_not_overwrite_remote_and_merge_commit_can_reconcile() {
        let dir = tempfile::tempdir().unwrap();
        let remote = repo(&dir, "remote");
        let a = repo(&dir, "a");
        let b = repo(&dir, "b");
        let path = remote.path.to_str().unwrap();
        let base = a.commit(&files(b"Base"), &[], "Base").unwrap();
        a.push(path, "main", &base).unwrap();
        b.fetch(path, "main").unwrap();
        let left = a
            .commit(&files(b"Left"), std::slice::from_ref(&base), "Left")
            .unwrap();
        let right = b
            .commit(&files(b"Right"), std::slice::from_ref(&base), "Right")
            .unwrap();
        a.push(path, "main", &left).unwrap();
        assert_eq!(b.push(path, "main", &right).unwrap_err().code, "git_failed");
        assert_eq!(
            remote.get_ref("refs/heads/main").unwrap(),
            Some(left.clone())
        );
        b.fetch(path, "main").unwrap();
        assert_eq!(b.merge_base(&left, &right).unwrap(), Some(base));
        let merged = b
            .commit(&files(b"Resolved"), &[right, left], "Resolve")
            .unwrap();
        b.push(path, "main", &merged).unwrap();
        assert_eq!(remote.get_ref("refs/heads/main").unwrap(), Some(merged));
        let unrelated = b.commit(&BTreeMap::new(), &[], "Unrelated").unwrap();
        assert_eq!(
            b.merge_base(
                &unrelated,
                &remote.get_ref("refs/heads/main").unwrap().unwrap()
            )
            .unwrap(),
            None
        );
    }

    #[test]
    fn remote_branch_oid_and_path_validation_rejects_execution_or_traversal_inputs() {
        for remote in [
            "https://github.com/user/repo.git",
            "ssh://git@example.com:2222/team/repo.git",
            "git@example.com:user/repo.git",
        ] {
            validate_remote(remote).unwrap();
        }
        for remote in [
            "",
            "-oProxyCommand=bad",
            "ext::bad",
            "file:///tmp/repo",
            "http://example.com/a",
            "https://user:secret@example.com/repo",
            "https://user@example.com/repo",
            "https://example.com:0/repo",
            "ssh://git@host:99999/repo",
            "https://host/a?access_token=secret",
            "git@host:a;bad",
            "git@host:$(bad)",
            "git@host:-oProxyCommand=bad",
            "https://host/a\nfoo",
        ] {
            assert!(validate_remote(remote).is_err(), "{remote}");
        }
        for branch in ["main", "notes/private", "feature-1.2"] {
            validate_branch(branch).unwrap();
        }
        for branch in [
            "", "-main", "HEAD", "../main", "a..b", "a//b", "a.lock", "a/.b", "a/", "a@{b", "a b",
        ] {
            assert!(validate_branch(branch).is_err(), "{branch}");
        }
        let dir = tempfile::tempdir().unwrap();
        let r = repo(&dir, "cache");
        for path in [
            "../note",
            "/note",
            "notes/../x",
            "notes/.git/config",
            "notes/.GIT/config",
            "notes/x\n",
            "notes\\x",
            "notes/x\"",
            "notes/",
            "notes/x.",
        ] {
            let invalid = BTreeMap::from([(path.to_owned(), vec![1])]);
            assert!(r.commit(&invalid, &[], "Invalid").is_err(), "{path}");
        }
        assert!(r.read_tree("HEAD").is_err());
        assert!(r.set_ref("HEAD", &"0".repeat(40)).is_err());
        assert!(r.merge_base("--help", &"0".repeat(40)).is_err());
    }

    #[test]
    fn local_remote_and_managed_cache_do_not_accept_hooks_config_or_alternate_objects() {
        let dir = tempfile::tempdir().unwrap();
        let r = repo(&dir, "remote");
        let path = r.path.to_str().unwrap();
        for extra in [
            "[include]\npath = /tmp/untrusted\n",
            "[core]\nhooksPath = /tmp/hooks\n",
            "[uploadpack]\npackObjectsHook = bad\n",
            "[remote \"origin\"]\nurl = ext::bad\n",
        ] {
            fs::write(r.path.join("config"), format!("{CONFIG}{extra}")).unwrap();
            assert!(validate_remote(path).is_err());
            assert!(GitRepo::open(&r.path).is_err());
        }
        fs::write(r.path.join("config"), CONFIG).unwrap();
        fs::create_dir_all(r.path.join("hooks")).unwrap();
        fs::write(r.path.join("hooks/pre-receive"), "#!/bin/sh\nexit 0\n").unwrap();
        assert!(validate_remote(path).is_err());
        fs::remove_file(r.path.join("hooks/pre-receive")).unwrap();
        fs::write(
            r.path.join("objects/info/alternates"),
            "/tmp/other/objects\n",
        )
        .unwrap();
        assert!(validate_remote(path).is_err());
        fs::remove_file(r.path.join("objects/info/alternates")).unwrap();
        validate_remote(path).unwrap();
    }

    #[test]
    #[cfg(unix)]
    fn symlinked_repository_object_and_ref_paths_are_rejected() {
        use std::os::unix::fs::symlink;
        let dir = tempfile::tempdir().unwrap();
        let r = repo(&dir, "remote");
        let alias = dir.path().join("alias");
        symlink(&r.path, &alias).unwrap();
        assert!(validate_remote(alias.to_str().unwrap()).is_err());
        assert!(GitRepo::open(&alias).is_err());
        for path in ["objects/outside", "refs/heads/outside"] {
            symlink(dir.path(), r.path.join(path)).unwrap();
            assert!(validate_remote(r.path.to_str().unwrap()).is_err());
            fs::remove_file(r.path.join(path)).unwrap();
        }
    }

    fn unchecked_tree(r: &GitRepo, mode: &str, path: &str, body: Vec<u8>) -> String {
        let blob = object_id(
            &r.checked(
                &["hash-object", "-w", "--stdin", "--no-filters"],
                Some(body),
                1024,
            )
            .unwrap(),
        )
        .unwrap();
        let tree = object_id(
            &r.checked(
                &["mktree", "-z"],
                Some(format!("{mode} blob {blob}\t{path}\0").into_bytes()),
                1024,
            )
            .unwrap(),
        )
        .unwrap();
        object_id(
            &r.checked(
                &["commit-tree", &tree, "-m", "Untrusted fixture"],
                None,
                1024,
            )
            .unwrap(),
        )
        .unwrap()
    }

    #[test]
    fn incoming_tree_rejects_symlinks_executable_files_and_oversized_blobs_before_reading() {
        let dir = tempfile::tempdir().unwrap();
        let r = repo(&dir, "cache");
        for mode in ["120000", "100755"] {
            let oid = unchecked_tree(&r, mode, "example", b"outside".to_vec());
            assert_eq!(r.read_tree(&oid).unwrap_err().code, "git_invalid");
        }
        let oid = unchecked_tree(&r, "100644", "large", vec![b'a'; MAX_BLOB_BYTES + 1]);
        assert_eq!(r.read_tree(&oid).unwrap_err().code, "git_limit");
        let too_many = (0..=MAX_FILES)
            .map(|i| (format!("notes/{i}.md"), vec![]))
            .collect();
        assert_eq!(
            r.commit(&too_many, &[], "Too many").unwrap_err().code,
            "git_limit"
        );
        let collision = BTreeMap::from([
            ("notes/A.md".to_owned(), vec![]),
            ("notes/a.md".to_owned(), vec![]),
        ]);
        assert_eq!(
            r.commit(&collision, &[], "Collision").unwrap_err().code,
            "git_invalid"
        );
    }

    #[test]
    fn output_and_cache_limits_fail_closed() {
        let flag = Arc::new(AtomicBool::new(false));
        let output = read_output(std::io::Cursor::new(vec![1; 100]), 16, flag.clone()).unwrap();
        assert_eq!(output.len(), 17);
        assert!(flag.load(Ordering::Relaxed));
        let dir = tempfile::tempdir().unwrap();
        let r = repo(&dir, "cache");
        let packed = r.path.join("objects/pack/too-large.pack");
        fs::File::create(&packed)
            .unwrap()
            .set_len(MAX_OBJECT_BYTES + 1)
            .unwrap();
        assert_eq!(object_bytes(&r.path).unwrap_err().code, "git_limit");
    }

    #[test]
    fn object_scan_tolerates_concurrent_temporary_file_and_directory_removal() {
        let dir = tempfile::tempdir().unwrap();
        let r = repo(&dir, "cache");
        let pack = r.path.join("objects/pack");
        fs::write(pack.join("stable.pack"), vec![0; 4096]).unwrap();
        let barrier = Arc::new(std::sync::Barrier::new(2));
        let writer_barrier = barrier.clone();
        let writer = thread::spawn(move || {
            writer_barrier.wait();
            for _ in 0..128 {
                let temporary = pack.join("tmp-objects");
                let renamed = pack.join("renamed-objects");
                fs::create_dir(&temporary).unwrap();
                for index in 0..16 {
                    let path = temporary.join(format!("tmp-{index}"));
                    fs::write(&path, b"temporary object").unwrap();
                    fs::rename(&path, temporary.join(format!("object-{index}"))).unwrap();
                }
                fs::rename(&temporary, &renamed).unwrap();
                fs::remove_dir_all(renamed).unwrap();
            }
        });
        barrier.wait();
        let scan_result = (0..512).try_for_each(|_| object_bytes(&r.path).map(|_| ()));
        writer.join().unwrap();
        scan_result.unwrap();
        assert_eq!(object_bytes(&r.path).unwrap(), 4096);
    }

    #[test]
    fn inherited_git_environment_is_not_used() {
        const CHILD: &str = "FOLTRA_GIT_ISOLATION_CHILD";
        if let Some(path) = std::env::var_os(CHILD) {
            let path = PathBuf::from(path);
            let r = GitRepo::open(&path.join("cache")).unwrap();
            let oid = r.commit(&files(b"Isolated"), &[], "Safe").unwrap();
            r.push(path.join("remote").to_str().unwrap(), "main", &oid)
                .unwrap();
            assert_eq!(r.read_tree(&oid).unwrap(), files(b"Isolated"));
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        repo(&dir, "remote");
        let global = dir.path().join("global.config");
        fs::write(&global, "[include]\npath = missing\n[core]\nhooksPath = /untrusted/hooks\n[protocol \"file\"]\nallow = never\n").unwrap();
        let output = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "git_transport::tests::inherited_git_environment_is_not_used",
                "--nocapture",
            ])
            .env(CHILD, dir.path())
            .env("GIT_CONFIG_GLOBAL", &global)
            .env("GIT_CONFIG_COUNT", "1")
            .env("GIT_CONFIG_KEY_0", "protocol.file.allow")
            .env("GIT_CONFIG_VALUE_0", "never")
            .env("GIT_OBJECT_DIRECTORY", dir.path().join("outside-objects"))
            .env("GIT_SSH_COMMAND", "must-not-execute")
            .env("GIT_DIR", dir.path().join("outside"))
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(!dir.path().join("outside-objects").exists());
        assert!(!dir.path().join("outside").exists());
    }
}
