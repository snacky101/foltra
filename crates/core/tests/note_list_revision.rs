use foltra_core::execute;
use serde_json::json;

#[test]
fn note_list_exposes_content_revision_without_body_or_mutating_metadata() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().to_str().unwrap();
    let call = |command: &str, args| execute(path, command, args).unwrap();
    call("vault.init", json!({"name":"Note summary revision"}));
    let note = call(
        "note.create",
        json!({"title":"2026-09-17","body":"original body"}),
    );
    let file = dir
        .path()
        .join(format!("notes/{}.md", note["id"].as_str().unwrap()));
    let original = std::fs::read_to_string(&file).unwrap();
    let before = call("note.list", json!({}));
    assert_eq!(before[0]["revision"], note["revision"]);
    assert!(before[0].get("body").is_none());
    assert_eq!(std::fs::read_to_string(&file).unwrap(), original);

    // External Markdown changes may preserve all metadata, including updatedAt.
    let edited = original.replace("original body", "changed body");
    std::fs::write(&file, &edited).unwrap();
    let after = call("note.list", json!({}));
    let read = call("note.read", json!({"id":note["id"]}));
    assert_eq!(after[0]["revision"], read["revision"]);
    assert_ne!(after[0]["revision"], before[0]["revision"]);
    for key in ["id", "title", "createdAt", "updatedAt", "folderId"] {
        assert_eq!(after[0][key], before[0][key]);
    }
    assert_eq!(std::fs::read_to_string(&file).unwrap(), edited);
}
