use base64::{engine::general_purpose::STANDARD, Engine};
use foltra_core::execute;
use image::{DynamicImage, ImageFormat};
use serde_json::{json, Value};
use std::{fs, io::Cursor};
use tempfile::TempDir;

fn call(dir: &TempDir, command: &str, args: Value) -> Value {
    execute(dir.path().to_str().unwrap(), command, args).unwrap()
}
fn vault() -> TempDir {
    let dir = tempfile::tempdir().unwrap();
    call(&dir, "vault.init", json!({"name":"Image test"}));
    dir
}
fn png() -> Vec<u8> {
    let mut bytes = Cursor::new(Vec::new());
    DynamicImage::new_rgb8(8, 4)
        .write_to(&mut bytes, ImageFormat::Png)
        .unwrap();
    bytes.into_inner()
}
fn import(dir: &TempDir) -> Value {
    call(
        dir,
        "attachment.import",
        json!({"data":STANDARD.encode(png())}),
    )
}

#[test]
fn images_are_real_vault_files_reused_without_changing_notes() {
    let dir = vault();
    let image = import(&dir);
    let path = image["path"].as_str().unwrap();
    assert_eq!(fs::read(dir.path().join(path)).unwrap(), png());
    assert_eq!(image["mimeType"], "image/png");
    assert_eq!(
        (
            image["width"].as_u64().unwrap(),
            image["height"].as_u64().unwrap()
        ),
        (8, 4)
    );
    assert_eq!(import(&dir), image);
    assert_eq!(
        fs::read_dir(dir.path().join("attachments"))
            .unwrap()
            .count(),
        1
    );
    assert_eq!(call(&dir, "note.list", json!({})), json!([]));
    assert_eq!(
        call(&dir, "attachment.read", json!({"path":path}))["data"],
        STANDARD.encode(png())
    );
    fs::write(dir.path().join(path), b"externally changed").unwrap();
    assert_eq!(
        execute(
            dir.path().to_str().unwrap(),
            "attachment.import",
            json!({"data":STANDARD.encode(png())})
        )
        .unwrap_err()
        .code,
        "attachment_conflict"
    );
    assert_eq!(
        fs::read(dir.path().join(path)).unwrap(),
        b"externally changed"
    );
}

#[test]
fn invalid_data_traversal_and_oversized_images_write_nothing() {
    let dir = vault();
    for data in [
        "not base64".to_string(),
        STANDARD.encode("<svg onload='bad()'/>"),
        STANDARD.encode([137, 80, 78, 71]),
        "A".repeat(14 * 1024 * 1024),
    ] {
        assert!(execute(
            dir.path().to_str().unwrap(),
            "attachment.import",
            json!({"data":data})
        )
        .is_err());
    }
    for path in [
        "../secret",
        "/etc/passwd",
        "attachments/../.foltra/settings.json",
        "attachments/a.svg",
    ] {
        assert_eq!(
            execute(
                dir.path().to_str().unwrap(),
                "attachment.read",
                json!({"path":path})
            )
            .unwrap_err()
            .code,
            "invalid_path"
        );
    }
    assert!(!dir.path().join("attachments").exists());
}

#[test]
fn backup_roundtrip_keeps_binary_images_and_relative_note_links() {
    let dir = vault();
    let image = import(&dir);
    let body = format!("![그림](../{})", image["path"].as_str().unwrap());
    let note = call(&dir, "note.create", json!({"title":"Image","body":body}));
    let snapshot = call(&dir, "vault.export", json!({}));
    assert_eq!(snapshot["version"], 2);
    let restored = tempfile::tempdir().unwrap();
    call(&restored, "vault.import", json!({"snapshot":snapshot}));
    assert_eq!(call(&restored, "note.read", json!({"id":note["id"]})), note);
    assert_eq!(
        call(&restored, "attachment.read", json!({"path":image["path"]}))["data"],
        STANDARD.encode(png())
    );
    let empty = vault();
    assert_eq!(call(&empty, "vault.export", json!({}))["version"], 1);
}

#[test]
fn bad_attachment_backup_is_rejected_before_any_file_is_restored() {
    let dir = vault();
    let image = import(&dir);
    let mut snapshot = call(&dir, "vault.export", json!({}));
    snapshot["attachments"][image["path"].as_str().unwrap()] = json!(STANDARD.encode("wrong"));
    let restored = tempfile::tempdir().unwrap();
    assert!(execute(
        restored.path().to_str().unwrap(),
        "vault.import",
        json!({"snapshot":snapshot})
    )
    .is_err());
    assert!(!restored.path().join(".foltra/vault.json").exists());
    assert!(!restored.path().join("attachments").exists());
}

#[test]
fn interrupted_binary_save_recovers_and_external_changes_stop_replay() {
    let dir = vault();
    let image = import(&dir);
    let path = image["path"].as_str().unwrap();
    fs::remove_file(dir.path().join(path)).unwrap();
    let journal = json!({"version":2,"entries":[{"path":path,"before":null,"after":STANDARD.encode(png()),"binary":true}]});
    let pending = dir.path().join(".foltra/local/pending.json");
    fs::write(&pending, serde_json::to_vec(&journal).unwrap()).unwrap();
    call(&dir, "attachment.read", json!({"path":path}));
    assert!(!pending.exists());
    assert_eq!(fs::read(dir.path().join(path)).unwrap(), png());
    fs::write(dir.path().join(path), b"external edit").unwrap();
    fs::write(&pending, serde_json::to_vec(&journal).unwrap()).unwrap();
    assert_eq!(
        execute(dir.path().to_str().unwrap(), "workspace.get", json!({}))
            .unwrap_err()
            .code,
        "recovery_conflict"
    );
    assert!(pending.exists());
    assert_eq!(fs::read(dir.path().join(path)).unwrap(), b"external edit");
}

#[cfg(unix)]
#[test]
fn attachment_directory_symlinks_cannot_escape_the_vault() {
    let dir = vault();
    let outside = tempfile::tempdir().unwrap();
    std::os::unix::fs::symlink(outside.path(), dir.path().join("attachments")).unwrap();
    assert_eq!(
        execute(
            dir.path().to_str().unwrap(),
            "attachment.import",
            json!({"data":STANDARD.encode(png())})
        )
        .unwrap_err()
        .code,
        "unsafe_path"
    );
    assert_eq!(fs::read_dir(outside.path()).unwrap().count(), 0);
}

#[test]
fn supported_raster_formats_use_detected_types_and_preserve_original_bytes() {
    let dir = vault();
    for (format, mime, extension) in [
        (ImageFormat::Jpeg, "image/jpeg", "jpg"),
        (ImageFormat::Gif, "image/gif", "gif"),
        (ImageFormat::WebP, "image/webp", "webp"),
    ] {
        let mut bytes = Cursor::new(Vec::new());
        DynamicImage::new_rgb8(12, 8)
            .write_to(&mut bytes, format)
            .unwrap();
        let image = call(
            &dir,
            "attachment.import",
            json!({"data":STANDARD.encode(bytes.get_ref())}),
        );
        assert_eq!(image["mimeType"], mime);
        assert!(image["path"].as_str().unwrap().ends_with(extension));
        assert_eq!(
            fs::read(dir.path().join(image["path"].as_str().unwrap())).unwrap(),
            bytes.into_inner()
        );
    }
}
