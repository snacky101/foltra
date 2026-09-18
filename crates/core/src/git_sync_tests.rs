//! Coordinator tests use real command dispatch and isolated local bare remotes.
use crate::{execute, storage::Store, sync_snapshot};
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    process::Command,
};

struct Pair {
    _root: tempfile::TempDir,
    remote: PathBuf,
    a: PathBuf,
    b: PathBuf,
}

fn call(path: &Path, command: &str, args: Value) -> Value {
    execute(path.to_str().unwrap(), command, args).unwrap()
}

fn git(remote: &Path, args: &[&str]) -> String {
    let output = Command::new("/usr/bin/git")
        .env_clear()
        .env("PATH", "/usr/bin:/bin:/usr/sbin:/sbin")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .arg("--git-dir")
        .arg(remote)
        .args(args)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "git {args:?}: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).unwrap().trim().into()
}

impl Pair {
    fn new() -> Self {
        let root = tempfile::tempdir().unwrap();
        let remote = root.path().join("remote.git");
        git(&remote, &["init", "--bare", "--quiet"]);
        let a = root.path().join("device-a");
        let b = root.path().join("device-b");
        for path in [&a, &b] {
            call(path, "vault.init", json!({"name":"Device vault"}));
        }
        Self {
            _root: root,
            remote,
            a,
            b,
        }
    }

    fn configure(&self, path: &Path) -> Value {
        let status = call(path, "git.status", json!({}));
        call(
            path,
            "git.configure",
            json!({
                "remote":self.remote.to_str().unwrap(), "branch":"main",
                "expectedRevision":status["configRevision"]
            }),
        )
    }

    fn share(&self) -> Value {
        let note = call(
            &self.a,
            "note.create",
            json!({"title":"Shared","body":"Original  \n\n- [b] Keep"}),
        );
        self.configure(&self.a);
        synced(&self.a);
        self.configure(&self.b);
        synced(&self.b);
        assert_eq!(read(&self.b, &note), note);
        note
    }

    fn head(&self) -> String {
        git(&self.remote, &["rev-parse", "refs/heads/main"])
    }
}

fn synced(path: &Path) -> Value {
    let status = call(path, "git.sync", json!({}));
    assert_eq!(status["phase"], "synced", "{status}");
    assert_eq!(status["conflictCount"], 0);
    status
}

fn read(path: &Path, note: &Value) -> Value {
    call(path, "note.read", json!({"id":note["id"]}))
}

fn edit(path: &Path, note: &Value, body: &str) -> Value {
    let current = read(path, note);
    call(
        path,
        "note.update",
        json!({"id":note["id"],"expectedRevision":current["revision"],"body":body}),
    )
}

fn snapshot(path: &Path) -> sync_snapshot::Snapshot {
    sync_snapshot::capture(&Store::open(path.to_str().unwrap(), false).unwrap()).unwrap()
}

fn conflict(pair: &Pair, note: &Value) -> Value {
    edit(&pair.a, note, "Remote edit");
    edit(&pair.b, note, "Local edit");
    synced(&pair.a);
    let status = call(&pair.b, "git.sync", json!({}));
    assert_eq!(status["phase"], "conflicts", "{status}");
    assert_eq!(status["conflictCount"], 1);
    assert_eq!(
        status["conflicts"][0]["path"],
        format!("notes/{}.md", note["id"].as_str().unwrap())
    );
    status
}

#[test]
fn git_bootstrap_and_two_device_independent_changes_preserve_raw_data_and_local_settings() {
    let pair = Pair::new();
    call(&pair.b, "settings.update", json!({"vim":true,"leader":","}));
    let settings = std::fs::read(pair.b.join(".foltra/settings.json")).unwrap();
    let note = pair.share();
    let first = call(
        &pair.a,
        "note.create",
        json!({"title":"A new","body":"A body"}),
    );
    let second = call(
        &pair.b,
        "note.create",
        json!({"title":"B new","body":"B body"}),
    );
    synced(&pair.a);
    synced(&pair.b);
    synced(&pair.a);
    assert_eq!(snapshot(&pair.a), snapshot(&pair.b));
    assert_eq!(read(&pair.a, &note), note);
    assert_eq!(read(&pair.b, &first), first);
    assert_eq!(read(&pair.a, &second), second);
    assert_eq!(
        std::fs::read(pair.b.join(".foltra/settings.json")).unwrap(),
        settings
    );
    let paths = git(
        &pair.remote,
        &["ls-tree", "-r", "--name-only", "refs/heads/main"],
    );
    assert!(paths.lines().any(|p| p == ".foltra/vault.json"));
    assert!(paths
        .lines()
        .all(|p| p == ".foltra/vault.json" || p.starts_with("notes/")));
    let before = snapshot(&pair.b);
    synced(&pair.b);
    assert_eq!(snapshot(&pair.b), before);
}

#[test]
fn git_divergent_edits_require_a_complete_explicit_choice_and_keep_both_originals_until_then() {
    let pair = Pair::new();
    let note = pair.share();
    let status = conflict(&pair, &note);
    assert!(status["conflicts"][0]["local"]
        .as_str()
        .unwrap()
        .contains("Local edit"));
    assert!(status["conflicts"][0]["remote"]
        .as_str()
        .unwrap()
        .contains("Remote edit"));
    assert_eq!(status["history"][0]["phase"], "conflicts");
    let local = snapshot(&pair.b);
    let head = pair.head();
    let incomplete = call(&pair.b, "git.resolve", json!({"jobId":status["jobId"]}));
    assert_eq!(incomplete["phase"], "conflicts");
    assert_eq!(snapshot(&pair.b), local);
    assert_eq!(pair.head(), head);
    let resolved = call(
        &pair.b,
        "git.resolve",
        json!({"jobId":status["jobId"],"all":"remote"}),
    );
    assert_eq!(resolved["phase"], "synced", "{resolved}");
    assert_eq!(read(&pair.b, &note), read(&pair.a, &note));
    assert_eq!(read(&pair.b, &note)["body"], "Remote edit");
}

#[test]
fn git_conflict_resolution_rejects_stale_job_or_changed_local_snapshot_without_writes() {
    let pair = Pair::new();
    let note = pair.share();
    let status = conflict(&pair, &note);
    edit(&pair.b, &note, "New local edit while conflict was open");
    let current = snapshot(&pair.b);
    let head = pair.head();
    for job_id in [status["jobId"].clone(), json!("old-job-id")] {
        let error = execute(
            pair.b.to_str().unwrap(),
            "git.resolve",
            json!({"jobId":job_id,"all":"remote"}),
        )
        .unwrap_err();
        assert_eq!(error.code, "conflict");
        assert_eq!(snapshot(&pair.b), current);
        assert_eq!(pair.head(), head);
    }
}

#[test]
fn git_remote_advance_during_conflict_never_forces_push_and_can_retry_pending_local_result() {
    let pair = Pair::new();
    let note = pair.share();
    let status = conflict(&pair, &note);
    let later = call(
        &pair.a,
        "note.create",
        json!({"title":"Later remote","body":"Keep"}),
    );
    synced(&pair.a);
    let latest_head = pair.head();
    let resolved = call(
        &pair.b,
        "git.resolve",
        json!({"jobId":status["jobId"],"all":"local"}),
    );
    assert_eq!(resolved["phase"], "push-pending", "{resolved}");
    assert_eq!(resolved["applied"], true);
    assert_eq!(pair.head(), latest_head);
    assert_eq!(read(&pair.b, &note)["body"], "Local edit");
    synced(&pair.b);
    assert_eq!(read(&pair.b, &later), later);
    assert_eq!(read(&pair.b, &note)["body"], "Local edit");
    synced(&pair.a);
    assert_eq!(snapshot(&pair.a), snapshot(&pair.b));
}

#[test]
fn git_configuration_uses_cas_and_automatic_sync_respects_disabled_setting() {
    let pair = Pair::new();
    let initial = call(&pair.a, "git.status", json!({}));
    let configured = pair.configure(&pair.a);
    assert_ne!(configured["configRevision"], initial["configRevision"]);
    let path = pair.a.join(".foltra/local/git/config.json");
    let before = std::fs::read(&path).unwrap();
    let error = execute(pair.a.to_str().unwrap(), "git.configure", json!({
        "remote":pair.remote.to_str().unwrap(),"branch":"other","expectedRevision":initial["configRevision"]
    })).unwrap_err();
    assert_eq!(error.code, "conflict");
    assert_eq!(std::fs::read(path).unwrap(), before);
    let source = snapshot(&pair.a);
    let automatic = call(&pair.a, "git.sync", json!({"automatic":true}));
    assert_eq!(automatic["phase"], configured["phase"]);
    assert_eq!(snapshot(&pair.a), source);
    assert!(!pair.remote.join("refs/heads/main").exists());
}

#[test]
fn git_different_nonempty_vaults_cannot_replace_identity_or_content() {
    let pair = Pair::new();
    call(&pair.a, "note.create", json!({"title":"A","body":"Remote"}));
    pair.configure(&pair.a);
    synced(&pair.a);
    call(&pair.b, "note.create", json!({"title":"B","body":"Local"}));
    pair.configure(&pair.b);
    let before = snapshot(&pair.b);
    let head = pair.head();
    let status = call(&pair.b, "git.sync", json!({}));
    assert_eq!(status["phase"], "error", "{status}");
    assert_eq!(status["applied"], false);
    assert_eq!(snapshot(&pair.b), before);
    assert_eq!(pair.head(), head);
}

#[test]
fn git_owner_revocation_blocks_saved_conflict_resolution_even_when_caller_omits_owner() {
    let pair = Pair::new();
    let note = pair.share();
    let manifest = json!({"id":"git-owner","kind":"plugin","name":"Git owner","version":"1.0.0",
        "commands":[],"runtime":{"apiVersion":1,"permissions":["git.sync"],"source":"export default {}"}});
    call(&pair.b, "extension.install", json!({"manifest":manifest}));
    let status = call(&pair.b, "extension.status", json!({}));
    let digest = status[0]["digest"].clone();
    call(
        &pair.b,
        "extension.enable",
        json!({"id":"git-owner","digest":digest}),
    );
    edit(&pair.a, &note, "Remote edit");
    edit(&pair.b, &note, "Local edit");
    synced(&pair.a);
    let conflict = call(
        &pair.b,
        "git.sync",
        json!({"pluginId":"git-owner","pluginDigest":digest}),
    );
    assert_eq!(conflict["phase"], "conflicts", "{conflict}");
    call(&pair.b, "extension.disable", json!({"id":"git-owner"}));
    let before = snapshot(&pair.b);
    let head = pair.head();
    let error = execute(
        pair.b.to_str().unwrap(),
        "git.resolve",
        json!({"jobId":conflict["jobId"],"all":"remote"}),
    )
    .unwrap_err();
    assert_eq!(error.code, "plugin_disabled");
    assert_eq!(snapshot(&pair.b), before);
    assert_eq!(pair.head(), head);
}

#[test]
fn git_semantic_schema_row_conflict_keeps_valid_local_data_until_consistent_resolution() {
    let pair = Pair::new();
    let database = call(&pair.a, "database.create", json!({"name":"Data"}));
    let row = call(
        &pair.a,
        "record.create",
        json!({"databaseId":database["id"],"values":{"title":"One"}}),
    );
    pair.configure(&pair.a);
    synced(&pair.a);
    pair.configure(&pair.b);
    synced(&pair.b);
    let inspect = call(&pair.a, "database.inspect", json!({"id":database["id"]}));
    call(
        &pair.a,
        "database.property.delete",
        json!({"databaseId":database["id"],"propertyId":"status","expectedRevision":inspect["revision"]}),
    );
    call(
        &pair.b,
        "record.update",
        json!({"id":row["id"],"expectedRevision":row["revision"],"values":{"status":"Done"}}),
    );
    synced(&pair.a);
    let before = snapshot(&pair.b);
    let status = call(&pair.b, "git.sync", json!({}));
    assert_eq!(status["phase"], "conflicts", "{status}");
    assert_eq!(snapshot(&pair.b), before);
    let schema_path = format!("databases/{}.json", database["id"].as_str().unwrap());
    let row_path = format!("records/{}.json", row["id"].as_str().unwrap());
    let mixed = call(
        &pair.b,
        "git.resolve",
        json!({"jobId":status["jobId"],"choices":{
            schema_path:"remote",row_path:"local"
        }}),
    );
    assert_eq!(mixed["phase"], "conflicts", "{mixed}");
    assert_eq!(snapshot(&pair.b), before);
    let consistent = call(
        &pair.b,
        "git.resolve",
        json!({"jobId":status["jobId"],"all":"local"}),
    );
    assert_eq!(consistent["phase"], "synced", "{consistent}");
    assert_eq!(snapshot(&pair.b), before);
}

#[test]
fn git_network_wait_releases_the_vault_writer_lock_for_editing_and_status() {
    use std::{
        net::TcpListener,
        sync::mpsc,
        thread,
        time::{Duration, Instant},
    };
    let pair = Pair::new();
    let note = call(
        &pair.a,
        "note.create",
        json!({"title":"Keep editing","body":"Before"}),
    );
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let remote = format!(
        "ssh://git@127.0.0.1:{}/repo",
        listener.local_addr().unwrap().port()
    );
    let status = call(&pair.a, "git.status", json!({}));
    call(
        &pair.a,
        "git.configure",
        json!({"remote":remote,"branch":"main","expectedRevision":status["configRevision"]}),
    );
    let path = pair.a.clone();
    let sync = thread::spawn(move || execute(path.to_str().unwrap(), "git.sync", json!({})));
    // Accepting SSH's TCP connection proves Git reached the network phase. Send no
    // handshake response, keeping it there while the independent writer runs.
    let started = Instant::now();
    let stream = loop {
        match listener.accept() {
            Ok((stream, _)) => break Some(stream),
            Err(error)
                if error.kind() == std::io::ErrorKind::WouldBlock
                    && started.elapsed() < Duration::from_secs(5) =>
            {
                thread::sleep(Duration::from_millis(10))
            }
            _ => break None,
        }
    };
    let (sent, received) = mpsc::channel();
    let path = pair.a.clone();
    let note_id = note["id"].clone();
    let revision = note["revision"].clone();
    let edit = thread::spawn(move || {
        let result = (|| -> crate::Result<Value> {
            let edited = execute(
                path.to_str().unwrap(),
                "note.update",
                json!({"id":note_id,"expectedRevision":revision,"body":"Typed during fetch"}),
            )?;
            let status = execute(path.to_str().unwrap(), "git.status", json!({}))?;
            let configure = execute(
                path.to_str().unwrap(),
                "git.configure",
                json!({"remote":remote,"expectedRevision":status["configRevision"]}),
            )
            .unwrap_err();
            Ok(json!({"note":edited,"phase":status["phase"],"configureError":configure.code}))
        })();
        let _ = sent.send(result);
    });
    let during_network = received.recv_timeout(Duration::from_secs(2));
    let connected = stream.is_some();
    // Always release the network barrier and join before asserting, even on regressions.
    drop(stream);
    drop(listener);
    let synced = sync.join().unwrap().unwrap();
    edit.join().unwrap();
    assert!(
        connected,
        "Git did not reach the isolated SSH listener: {synced}"
    );
    let during = during_network
        .expect("Note update/status blocked behind network I/O")
        .unwrap();
    assert_eq!(during["phase"], "running");
    assert_eq!(during["configureError"], "git_busy");
    assert_eq!(read(&pair.a, &note), during["note"]);
    assert_eq!(synced["phase"], "error");
    assert_eq!(synced["applied"], false);
}

#[test]
fn git_deleted_remote_branch_is_not_recreated_after_an_existing_checkpoint() {
    let pair = Pair::new();
    let note = pair.share();
    let status = call(&pair.a, "git.status", json!({}));
    call(
        &pair.a,
        "git.configure",
        json!({"remote":pair.remote.to_str().unwrap(),
        "branch":"main","automatic":true,"expectedRevision":status["configRevision"]}),
    );
    let head = pair.head();
    git(
        &pair.remote,
        &["update-ref", "-d", "refs/heads/main", &head],
    );
    let before = snapshot(&pair.a);
    for args in [json!({"automatic":true}), json!({})] {
        let result = call(&pair.a, "git.sync", args);
        assert_eq!(result["phase"], "error", "{result}");
        assert_eq!(result["applied"], false);
        assert_eq!(snapshot(&pair.a), before);
        assert_eq!(read(&pair.a, &note), note);
        assert!(git(
            &pair.remote,
            &["for-each-ref", "--format=%(refname)", "refs/heads/main"]
        )
        .is_empty());
    }
}
