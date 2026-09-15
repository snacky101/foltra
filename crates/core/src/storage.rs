use crate::{Error, Result};
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Component, Path, PathBuf},
};
use uuid::Uuid;

pub fn revision(text: &str) -> String {
    format!("{:x}", Sha256::digest(text.as_bytes()))
}

pub fn safe_path(root: &Path, relative: &str) -> Result<PathBuf> {
    if relative.is_empty()
        || !Path::new(relative)
            .components()
            .all(|p| matches!(p, Component::Normal(_)))
    {
        return Err(Error::new(
            "invalid_path",
            "Path must stay inside the vault",
        ));
    }
    let mut path = root.to_path_buf();
    for component in Path::new(relative).components() {
        path.push(component);
        match fs::symlink_metadata(&path) {
            Ok(meta) if meta.file_type().is_symlink() => {
                return Err(Error::new(
                    "unsafe_path",
                    "Symlinks are not allowed in managed vault data",
                ))
            }
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.into()),
        }
    }
    Ok(path)
}

fn sync_dir(path: &Path) -> Result<()> {
    #[cfg(unix)]
    File::open(path)?.sync_all()?;
    Ok(())
}

fn atomic_write(path: &Path, text: &str) -> Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| Error::new("invalid_path", "Missing parent directory"))?;
    fs::create_dir_all(parent)?;
    let temp = parent.join(format!(".foltra-{}.tmp", Uuid::new_v4()));
    let result = (|| -> Result<()> {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temp)?;
        file.write_all(text.as_bytes())?;
        file.sync_all()?;
        fs::rename(&temp, path)?;
        sync_dir(parent)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

#[derive(Serialize, Deserialize)]
struct Entry {
    path: String,
    before: Option<String>,
    after: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct Journal {
    version: u32,
    entries: Vec<Entry>,
}

pub struct Store {
    pub root: PathBuf,
    _lock: File,
}

impl Store {
    pub fn open(path: &str, create: bool) -> Result<Self> {
        if path.trim().is_empty() {
            return Err(Error::new("vault_required", "Choose a vault path"));
        }
        let path = if let Some(rest) = path.strip_prefix("~/") {
            dirs::home_dir()
                .ok_or_else(|| Error::new("invalid_path", "Home directory unavailable"))?
                .join(rest)
        } else {
            PathBuf::from(path)
        };
        if create {
            fs::create_dir_all(&path)?;
        }
        let root = fs::canonicalize(&path)?;
        if !create && !safe_path(&root, ".foltra/vault.json")?.is_file() {
            return Err(Error::new(
                "not_a_vault",
                "This folder is not a Foltra vault",
            ));
        }
        let local = safe_path(&root, ".foltra/local")?;
        fs::create_dir_all(&local)?;
        let lock_path = safe_path(&root, ".foltra/local/write.lock")?;
        let mut options = OpenOptions::new();
        options.read(true).write(true).create(true).truncate(false);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let lock = options.open(lock_path)?;
        lock.lock_exclusive()?;
        let store = Self { root, _lock: lock };
        store.recover()?;
        Ok(store)
    }

    pub fn read(&self, relative: &str) -> Result<String> {
        let path = safe_path(&self.root, relative)?;
        if fs::metadata(&path)?.len() > 16 * 1024 * 1024 {
            return Err(Error::new(
                "file_too_large",
                "Managed text files are limited to 16 MiB in this preview",
            ));
        }
        Ok(fs::read_to_string(path)?)
    }

    pub fn optional(&self, relative: &str) -> Result<Option<String>> {
        let path = safe_path(&self.root, relative)?;
        if !path.exists() {
            return Ok(None);
        }
        self.read(relative).map(Some)
    }

    pub fn files(&self, relative: &str, extension: &str) -> Result<Vec<String>> {
        let path = safe_path(&self.root, relative)?;
        if !path.exists() {
            return Ok(vec![]);
        }
        let mut files = vec![];
        for entry in fs::read_dir(path)? {
            let entry = entry?;
            let name = entry.file_name().to_string_lossy().into_owned();
            let rel = format!("{relative}/{name}");
            let path = safe_path(&self.root, &rel)?;
            if path.is_file() && path.extension().is_some_and(|e| e == extension) {
                files.push(rel);
            }
        }
        files.sort();
        Ok(files)
    }

    pub fn commit(&self, writes: Vec<(String, Option<String>)>) -> Result<()> {
        let mut entries = vec![];
        for (path, after) in writes {
            safe_path(&self.root, &path)?;
            entries.push(Entry {
                before: self.optional(&path)?,
                path,
                after,
            });
        }
        let journal = Journal {
            version: 1,
            entries,
        };
        let pending = safe_path(&self.root, ".foltra/local/pending.json")?;
        if pending.exists() {
            return Err(Error::new(
                "recovery_required",
                "An earlier save needs recovery",
            ));
        }
        atomic_write(&pending, &serde_json::to_string(&journal)?)?;
        self.apply(&journal)?;
        fs::remove_file(pending)?;
        sync_dir(&self.root.join(".foltra/local"))?;
        Ok(())
    }

    fn apply(&self, journal: &Journal) -> Result<()> {
        if journal.version != 1 {
            return Err(Error::new(
                "unsupported_format",
                "Unknown recovery journal version",
            ));
        }
        // Check every precondition before replaying any remaining writes.
        for entry in &journal.entries {
            let current = self.optional(&entry.path)?;
            if current != entry.before && current != entry.after {
                return Err(Error::new(
                    "recovery_conflict",
                    format!(
                        "External changes conflict with recovery: {}. The journal is preserved.",
                        entry.path
                    ),
                ));
            }
        }
        for entry in &journal.entries {
            let path = safe_path(&self.root, &entry.path)?;
            if let Some(text) = &entry.after {
                atomic_write(&path, text)?;
            } else if path.exists() {
                fs::remove_file(&path)?;
                sync_dir(path.parent().unwrap())?;
            }
        }
        Ok(())
    }

    fn recover(&self) -> Result<()> {
        if let Some(text) = self.optional(".foltra/local/pending.json")? {
            let journal: Journal = serde_json::from_str(&text)?;
            self.apply(&journal)?;
            fs::remove_file(safe_path(&self.root, ".foltra/local/pending.json")?)?;
            sync_dir(&self.root.join(".foltra/local"))?;
        }
        Ok(())
    }
}
