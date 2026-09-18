//! Optional Git transport. Never keep Store (the vault writer lock) across Git I/O.
use crate::git_transport::{self, GitRepo};
use crate::storage::{revision, safe_path, Store};
use crate::sync_snapshot::{self, Snapshot};
use crate::{new_id, now, text, Error, Result};
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::fs::{File, OpenOptions};

const CONFIG: &str = ".foltra/local/git/config.json";
const STATE: &str = ".foltra/local/git/state.json";
const HISTORY: &str = ".foltra/local/git/history.json";

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Config {
    remote: String,
    branch: String,
    automatic: bool,
    interval_minutes: u32,
}
#[derive(Clone, Serialize, Deserialize)]
struct Owner {
    id: String,
    digest: String,
}
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Job {
    id: String,
    phase: String,
    message: String,
    updated_at: String,
    expected_revision: String,
    local: Option<String>,
    remote: Option<String>,
    base: Option<String>,
    conflicts: Vec<String>,
    previews: Vec<Value>,
    applied: bool,
    owner: Option<Owner>,
}
fn config(store: &Store) -> Result<Option<Config>> {
    store
        .optional(CONFIG)?
        .map(|v| serde_json::from_str(&v).map_err(Into::into))
        .transpose()
}
fn job(store: &Store) -> Result<Job> {
    store
        .optional(STATE)?
        .map(|v| serde_json::from_str(&v).map_err(Into::into))
        .transpose()
        .map(|v| v.unwrap_or_default())
}
fn lock(store: &Store) -> Result<File> {
    let path = safe_path(&store.root, ".foltra/local/git/operation.lock")?;
    std::fs::create_dir_all(path.parent().unwrap())?;
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(path)?;
    file.try_lock_exclusive()
        .map_err(|_| Error::new("git_busy", "Git 동기화가 진행 중입니다."))?;
    Ok(file)
}
fn owner(args: &Value) -> Result<Option<Owner>> {
    if args.get("pluginId").is_none() && args.get("pluginDigest").is_none() {
        return Ok(None);
    }
    Ok(Some(Owner {
        id: text(args, "pluginId")?.into(),
        digest: text(args, "pluginDigest")?.into(),
    }))
}
fn authorize(store: &Store, owner: &Option<Owner>) -> Result<()> {
    if let Some(owner) = owner {
        crate::plugin_runtime::authorize_git(store, &owner.id, &owner.digest)?;
    }
    Ok(())
}
fn save_job(store: &Store, job: &mut Job, phase: &str, message: &str) -> Result<()> {
    job.phase = phase.into();
    job.message = message.into();
    job.updated_at = now();
    let mut writes = vec![(STATE.into(), Some(serde_json::to_string(job)?))];
    if phase != "running" {
        let mut entries = history(store)?;
        entries.retain(|entry| entry["id"] != job.id);
        entries.insert(0,json!({"id":job.id,"phase":phase,"message":message,"updatedAt":job.updated_at,
            "localCommit":job.local,"remoteCommit":job.remote,"remote":config(store)?.map(|c|c.remote)}));
        entries.truncate(20);
        writes.push((HISTORY.into(), Some(serde_json::to_string(&entries)?)));
    }
    store.commit(writes)
}
fn history(store: &Store) -> Result<Vec<Value>> {
    store
        .optional(HISTORY)?
        .map(|raw| serde_json::from_str(&raw).map_err(Into::into))
        .transpose()
        .map(|value| value.unwrap_or_default())
}
pub(crate) fn status(store: &Store) -> Result<Value> {
    let mut job = job(store)?;
    if job.phase == "running" && lock(store).is_ok() {
        job.phase = "interrupted".into();
        job.message =
            "이전 작업이 중단되었습니다. 다시 동기화하면 현재 원본을 기준으로 재검사합니다.".into();
    }
    Ok(
        json!({"config":config(store)?,"configRevision":revision(&store.optional(CONFIG)?.unwrap_or_default()),
        "jobId":job.id,"phase":job.phase,"message":job.message,"updatedAt":job.updated_at,
        "applied":job.applied,"conflictCount":job.conflicts.len(),"conflicts":job.previews,
        "localCommit":job.local,"remoteCommit":job.remote,"history":history(store)?}),
    )
}
pub(crate) fn configure(store: &Store, args: &Value) -> Result<Value> {
    let _lock = lock(store)?;
    authorize(store, &owner(args)?)?;
    if text(args, "expectedRevision")? != revision(&store.optional(CONFIG)?.unwrap_or_default()) {
        return Err(Error::new(
            "conflict",
            "Git 연결 설정이 변경되었습니다. 다시 열어 주세요.",
        ));
    }
    let remote = text(args, "remote")?.trim();
    git_transport::validate_remote(remote)?;
    let branch = args["branch"].as_str().unwrap_or("main");
    git_transport::validate_branch(branch)?;
    let interval = args["intervalMinutes"].as_u64().unwrap_or(5);
    if !(1..=1440).contains(&interval) {
        return Err(Error::new(
            "invalid_arguments",
            "동기화 간격은 1~1440분입니다.",
        ));
    }
    let next = Config {
        remote: remote.into(),
        branch: branch.into(),
        automatic: args["automatic"].as_bool().unwrap_or(false),
        interval_minutes: interval as u32,
    };
    store.commit(vec![
        (CONFIG.into(), Some(serde_json::to_string(&next)?)),
        (STATE.into(), None),
    ])?;
    status(store)
}
fn repo(store: &Store, config: &Config) -> Result<GitRepo> {
    let key = revision(&format!("{}\n{}", config.remote, config.branch));
    GitRepo::open(&safe_path(
        &store.root,
        &format!(".foltra/local/git/repos/{key}"),
    )?)
}
fn vault_id(files: &Snapshot) -> Result<String> {
    let bytes = files.get(".foltra/vault.json").ok_or_else(|| {
        Error::new(
            "invalid_sync",
            "Foltra 전용 저장소가 아닙니다. 빈 Git 저장소를 연결해 주세요.",
        )
    })?;
    let info: Value = serde_json::from_slice(bytes)?;
    Ok(text(&info, "id")?.to_owned())
}
fn empty(files: &Snapshot) -> bool {
    files.keys().all(|p| p.starts_with(".foltra/"))
}
fn previews(paths: &[String], local: &Snapshot, remote: &Snapshot) -> Vec<Value> {
    paths
        .iter()
        .take(40)
        .map(|p| {
            let content = |files: &Snapshot| {
                files.get(p).map(|b| {
                    let raw = String::from_utf8_lossy(b);
                    if p.starts_with("notes/") {
                        if let Ok(note) = crate::Note::parse(&raw) {
                            return format!("{}\n{}", note.meta.title, note.body);
                        }
                    }
                    raw.into_owned()
                })
            };
            let left = content(local);
            let right = content(remote);
            let common = left
                .as_deref()
                .unwrap_or_default()
                .chars()
                .zip(right.as_deref().unwrap_or_default().chars())
                .take_while(|(a, b)| a == b)
                .count();
            let start = common.saturating_sub(60);
            let snippet = |value: Option<String>| {
                value.map(|value| {
                    let end = value.chars().count() > start + 260;
                    format!(
                        "{}{}{}",
                        if start > 0 { "…" } else { "" },
                        value.chars().skip(start).take(260).collect::<String>(),
                        if end { "…" } else { "" }
                    )
                })
            };
            json!({"path":p,"local":snippet(left),"remote":snippet(right)})
        })
        .collect()
}

/// Runs in a separate host/CLI request, after the bounded plugin invocation returned.
pub(crate) fn run(path: &str, command: &str, args: &Value) -> Result<Value> {
    let (guard, cfg, mut task, local, repository) = {
        let store = Store::open(path, false)?;
        let guard = match lock(&store) {
            Ok(lock) => lock,
            Err(error) if error.code == "git_busy" => return status(&store),
            Err(error) => return Err(error),
        };
        let cfg = config(&store)?
            .ok_or_else(|| Error::new("git_not_connected", "먼저 Git 저장소를 연결해 주세요."))?;
        let requested_owner = owner(args)?;
        authorize(&store, &requested_owner)?;
        let old = job(&store)?;
        if args["automatic"] == true {
            let recent = chrono::DateTime::parse_from_rfc3339(&old.updated_at)
                .ok()
                .is_some_and(|at| {
                    chrono::Utc::now().signed_duration_since(at).num_seconds()
                        < i64::from(cfg.interval_minutes) * 60
                });
            // Never resolve a conflict or repeatedly retry a failed network request automatically.
            if !cfg.automatic
                || recent
                || [
                    "running",
                    "conflicts",
                    "error",
                    "push-pending",
                    "interrupted",
                ]
                .contains(&old.phase.as_str())
            {
                return status(&store);
            }
        }
        let local = sync_snapshot::capture(&store)?;
        let mut task = if command == "git.resolve" {
            if old.id != text(args, "jobId")? || old.phase != "conflicts" {
                return Err(Error::new(
                    "conflict",
                    "이 충돌 작업은 더 이상 유효하지 않습니다.",
                ));
            }
            if old.expected_revision != sync_snapshot::revision(&local) {
                return Err(Error::new(
                    "conflict",
                    "충돌 확인 후 원본이 변경되었습니다. 다시 동기화해 주세요.",
                ));
            }
            old
        } else {
            Job {
                id: new_id(),
                expected_revision: sync_snapshot::revision(&local),
                owner: requested_owner,
                ..Job::default()
            }
        };
        authorize(&store, &task.owner)?;
        let repository = repo(&store, &cfg)?;
        save_job(
            &store,
            &mut task,
            "running",
            "Git 저장소를 확인하고 있습니다.",
        )?;
        (guard, cfg, task, local, repository)
    };
    let result = if command == "git.resolve" {
        resolve(path, &cfg, &repository, &mut task, &local, args)
    } else {
        synchronize(path, &cfg, &repository, &mut task, &local)
    };
    if let Err(error) = result {
        let store = Store::open(path, false)?;
        let phase = if task.applied {
            "push-pending"
        } else {
            "error"
        };
        let message = format!(
            "{}{}",
            if task.applied {
                "로컬 반영 완료 · 원격 전송 대기. "
            } else {
                "원본을 덮어쓰지 않았습니다. "
            },
            error.message
        );
        save_job(&store, &mut task, phase, &message)?;
    }
    drop(guard);
    status(&Store::open(path, false)?)
}

fn synchronize(
    path: &str,
    cfg: &Config,
    repo: &GitRepo,
    task: &mut Job,
    local: &Snapshot,
) -> Result<()> {
    let parents: Vec<String> = repo.get_ref("refs/foltra/applied")?.into_iter().collect();
    let unchanged = parents
        .first()
        .map(|oid| repo.read_tree(oid).map(|tree| tree == *local))
        .transpose()?
        .unwrap_or(false);
    let local_commit = if unchanged {
        parents[0].clone()
    } else {
        repo.commit(local, &parents, "Foltra local snapshot")?
    };
    if !unchanged {
        repo.set_ref(&format!("refs/foltra/snapshots/{}", task.id), &local_commit)?;
    }
    task.local = Some(local_commit.clone());
    let remote_commit = repo.fetch(&cfg.remote, &cfg.branch)?;
    task.remote = remote_commit.clone();
    let Some(remote_commit) = remote_commit else {
        if !parents.is_empty() {
            return Err(Error::new(
                "git_remote_missing",
                "연결했던 원격 브랜치가 삭제되었습니다. 저장소 상태를 확인해 주세요.",
            ));
        }
        return apply_push(path, cfg, repo, task, local);
    };
    if parents.first() != Some(&remote_commit) {
        repo.set_ref(&format!("refs/foltra/remotes/{}", task.id), &remote_commit)?;
    }
    let remote = repo.read_tree(&remote_commit)?;
    sync_snapshot::validate(&remote)?;
    if *local == remote {
        let store = Store::open(path, false)?;
        authorize(&store, &task.owner)?;
        if sync_snapshot::revision(&sync_snapshot::capture(&store)?) != task.expected_revision {
            return Err(Error::new(
                "conflict",
                "동기화 중 원본이 변경되었습니다. 다시 실행해 주세요.",
            ));
        }
        repo.set_ref("refs/foltra/applied", &remote_commit)?;
        return save_job(
            &store,
            task,
            "synced",
            "동기화 완료 · 모든 변경이 반영되어 있습니다.",
        );
    }
    if vault_id(local)? != vault_id(&remote)? {
        if empty(local) {
            return apply_push(path, cfg, repo, task, &remote);
        }
        return Err(Error::new(
            "different_vault",
            "서로 다른 vault입니다. 이 저장소를 사용하려면 예제 없는 새 vault에서 연결해 주세요.",
        ));
    }
    task.base = repo.merge_base(&local_commit, &remote_commit)?;
    let base = task
        .base
        .as_deref()
        .map(|oid| repo.read_tree(oid))
        .transpose()?;
    let merged = sync_snapshot::merge(base.as_ref(), local, &remote);
    task.conflicts = merged.conflicts;
    if !task.conflicts.is_empty() {
        return record_conflicts(
            path,
            task,
            local,
            &remote,
            "양쪽에서 수정된 파일을 선택해 주세요. 두 원본은 로컬 Git 이력에 보존됩니다.",
        );
    }
    if let Err(error) = sync_snapshot::validate(&merged.files) {
        task.conflicts = local
            .keys()
            .chain(remote.keys())
            .filter(|p| local.get(*p) != remote.get(*p))
            .cloned()
            .collect();
        task.conflicts.sort();
        task.conflicts.dedup();
        return record_conflicts(
            path,
            task,
            local,
            &remote,
            &format!(
                "변경을 함께 적용하면 데이터 구조가 맞지 않습니다: {}",
                error.message
            ),
        );
    }
    apply_push(path, cfg, repo, task, &merged.files)
}
fn record_conflicts(
    path: &str,
    task: &mut Job,
    local: &Snapshot,
    remote: &Snapshot,
    message: &str,
) -> Result<()> {
    task.previews = previews(&task.conflicts, local, remote);
    save_job(&Store::open(path, false)?, task, "conflicts", message)
}
fn resolve(
    path: &str,
    cfg: &Config,
    repo: &GitRepo,
    task: &mut Job,
    local: &Snapshot,
    args: &Value,
) -> Result<()> {
    let remote = repo.read_tree(
        task.remote
            .as_deref()
            .ok_or_else(|| Error::new("invalid_sync", "원격 snapshot이 없습니다."))?,
    )?;
    let base = task
        .base
        .as_deref()
        .map(|oid| repo.read_tree(oid))
        .transpose()?;
    let mut files = sync_snapshot::merge(base.as_ref(), local, &remote).files;
    let choices: BTreeMap<String, String> =
        serde_json::from_value(args.get("choices").cloned().unwrap_or(json!({})))?;
    let all = args["all"].as_str();
    for conflict_path in &task.conflicts {
        let side = choices.get(conflict_path).map(String::as_str).or(all);
        let source = match side {
            Some("local") => local,
            Some("remote") => &remote,
            _ => {
                return record_conflicts(
                    path,
                    task,
                    local,
                    &remote,
                    "모든 충돌에 대해 내 변경 또는 원격 변경을 선택해 주세요.",
                )
            }
        };
        if let Some(value) = source.get(conflict_path) {
            files.insert(conflict_path.clone(), value.clone());
        } else {
            files.remove(conflict_path);
        }
    }
    if let Err(error) = sync_snapshot::validate(&files) {
        return record_conflicts(
            path,
            task,
            local,
            &remote,
            &format!("선택한 조합을 적용할 수 없습니다: {}", error.message),
        );
    }
    apply_push(path, cfg, repo, task, &files)
}
fn apply_push(
    path: &str,
    cfg: &Config,
    repo: &GitRepo,
    task: &mut Job,
    files: &Snapshot,
) -> Result<()> {
    sync_snapshot::validate(files)?;
    let mut parents: Vec<String> = task
        .local
        .iter()
        .chain(task.remote.iter())
        .cloned()
        .collect();
    parents.dedup();
    let commit = repo.commit(files, &parents, "Foltra sync")?;
    repo.set_ref(&format!("refs/foltra/results/{}", task.id), &commit)?;
    {
        let store = Store::open(path, false)?;
        authorize(&store, &task.owner)?;
        sync_snapshot::apply(&store, &task.expected_revision, files)?;
        task.applied = true;
        save_job(
            &store,
            task,
            "running",
            "로컬 반영 완료 · 원격으로 전송하고 있습니다.",
        )?;
    }
    repo.set_ref("refs/foltra/applied", &commit)?;
    {
        let store = Store::open(path, false)?;
        authorize(&store, &task.owner)?;
    }
    repo.push(&cfg.remote, &cfg.branch, &commit)?;
    task.conflicts.clear();
    task.previews.clear();
    save_job(&Store::open(path, false)?, task, "synced", "동기화 완료")
}
