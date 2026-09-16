use crate::{storage::Store, text, Error, Result};
use serde_json::{json, Value};
use std::sync::LazyLock;
use std::time::Duration;
const CARD_BACK: &str = "{{FrontSide}}<hr>{{Back}}";
const LEGACY_CARD_BACK: &str = "{{FrontSide}}<hr>{{Back}}<br><small>{{Source}}</small>";
static MEDIA_IMAGE: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r#"<img src="foltra-[a-f0-9]{64}\.(?:png|jpg|gif|webp)">"#).unwrap()
});

fn card_templates(back: &str) -> Value {
    json!([{"Name":"Card 1","Front":"{{Front}}","Back":back}])
}

fn request_params(action: &str, params: &Value) -> Value {
    let mut params = params.clone();
    // Installed 1.0.0/1.0.1 packages keep their code and grants. Their exact
    // default model gets the same clean card face when they create a new model.
    if action == "createModel"
        && params["modelName"] == "Foltra"
        && params["cardTemplates"] == card_templates(LEGACY_CARD_BACK)
    {
        params["cardTemplates"] = card_templates(CARD_BACK);
    }
    params
}
fn invalid() -> Error {
    Error::new(
        "anki_request",
        "Unsupported AnkiConnect action or arguments",
    )
}
fn only(value: &Value, keys: &[&str]) -> Result<()> {
    if !value
        .as_object()
        .is_some_and(|o| o.keys().all(|k| keys.contains(&k.as_str())))
    {
        return Err(invalid());
    }
    Ok(())
}
fn safe_html(value: &str) -> bool {
    let mut plain = MEDIA_IMAGE.replace_all(value, "").into_owned();
    for tag in [
        "br", "hr", "b", "strong", "i", "em", "code", "p", "ul", "ol", "li", "small",
    ] {
        plain = plain
            .replace(&format!("<{tag}>"), "")
            .replace(&format!("</{tag}>"), "");
    }
    value.len() <= 100_000 && !plain.contains('<')
}
fn fields(value: &Value) -> Result<()> {
    if !value.as_object().is_some_and(|m| {
        !m.is_empty() && m.len() <= 20 && m.values().all(|v| v.as_str().is_some_and(safe_html))
    }) {
        return Err(invalid());
    }
    Ok(())
}
fn validate(action: &str, params: &Value) -> Result<()> {
    if params.to_string().len() > 200_000 {
        return Err(invalid());
    }
    match action {
        "version" | "deckNames" | "modelNames" | "getActiveProfile" => only(params, &[])?,
        "createDeck" => {
            only(params, &["deck"])?;
            if text(params, "deck")?.len() > 200 {
                return Err(invalid());
            }
        }
        "modelFieldNames" => {
            only(params, &["modelName"])?;
            text(params, "modelName")?;
        }
        "findNotes" | "guiBrowse" => {
            only(params, &["query"])?;
            if text(params, "query")?.len() > 500 {
                return Err(invalid());
            }
        }
        "notesInfo" => {
            only(params, &["notes"])?;
            if !params["notes"]
                .as_array()
                .is_some_and(|a| a.len() <= 50 && a.iter().all(|v| v.as_u64().is_some()))
            {
                return Err(invalid());
            }
        }
        "createModel" => {
            only(params, &["modelName", "inOrderFields", "cardTemplates"])?;
            text(params, "modelName")?;
            if params["inOrderFields"] != json!(["Front", "Back", "Source"])
                || (params["cardTemplates"] != card_templates(CARD_BACK)
                    && params["cardTemplates"] != card_templates(LEGACY_CARD_BACK))
            {
                return Err(invalid());
            }
        }
        "addNote" | "updateNoteFields" => {
            only(params, &["note"])?;
            let note = &params["note"];
            if action == "addNote" {
                only(
                    note,
                    &["deckName", "modelName", "fields", "tags", "options"],
                )?;
                text(note, "deckName")?;
                text(note, "modelName")?;
                if !note["tags"].as_array().is_some_and(|a| {
                    a.len() <= 20
                        && a.iter().all(|v| {
                            v.as_str().is_some_and(|s| {
                                s.len() <= 250 && !s.chars().any(char::is_whitespace)
                            })
                        })
                }) {
                    return Err(invalid());
                }
                if note
                    .get("options")
                    .is_some_and(|v| v != &json!({"allowDuplicate":true}))
                {
                    return Err(invalid());
                }
            } else {
                only(note, &["id", "fields"])?;
                if note["id"].as_u64().is_none() {
                    return Err(invalid());
                }
            }
            fields(&note["fields"])?;
        }
        _ => return Err(invalid()),
    }
    Ok(())
}
pub fn request(action: &str, params: &Value) -> Result<Value> {
    let params = request_params(action, params);
    validate(action, &params)?;
    request_at(8765, action, &params)
}
pub fn store_vault_image(store: &Store, params: &Value) -> Result<Value> {
    store_vault_image_at(store, params, 8765)
}
fn store_vault_image_at(store: &Store, params: &Value, port: u16) -> Result<Value> {
    only(params, &["path", "profile"])?;
    let profile = text(params, "profile")?;
    if profile.is_empty() || profile.len() > 200 {
        return Err(invalid());
    }
    let image = crate::attachments::read(store, &json!({"path":text(params, "path")?}))?;
    let path = image["path"].as_str().unwrap();
    let filename = format!("foltra-{}", path.strip_prefix("attachments/").unwrap());
    if request_at(port, "getActiveProfile", &json!({}))? != profile {
        return Err(Error::new(
            "anki_profile",
            "Anki 프로필이 바뀌어 이미지 전송을 중단했습니다.",
        ));
    }
    // Only validated vault bytes are sent. Never give Anki a filesystem path or URL,
    // and never delete an existing media file when its content differs.
    let result = request_at(
        port,
        "storeMediaFile",
        &json!({"filename":filename,"data":image["data"],"deleteExisting":false}),
    )?;
    if result != filename {
        return Err(Error::new(
            "anki_media_conflict",
            "Anki에 같은 이름의 다른 이미지가 있습니다. 기존 파일과 카드는 덮어쓰지 않았습니다.",
        ));
    }
    Ok(result)
}
fn request_at(port: u16, action: &str, params: &Value) -> Result<Value> {
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .proxy(None)
        .max_redirects(0)
        .timeout_global(Some(Duration::from_millis(1200)))
        .build()
        .into();
    let mut body = json!({"action":action,"version":6,"params":params});
    if let Ok(key) = std::env::var("FOLTRA_ANKICONNECT_KEY") {
        body["key"] = json!(key);
    }
    let mut response=agent.post(format!("http://127.0.0.1:{port}")).send_json(&body)
        .map_err(|_|Error::new("anki_unavailable","AnkiConnect에 연결할 수 없습니다. Anki와 AnkiConnect(127.0.0.1:8765)를 확인하세요."))?;
    if response.status() != 200 {
        return Err(Error::new(
            "anki_response",
            "AnkiConnect returned a non-200 response",
        ));
    }
    let envelope: Value = response
        .body_mut()
        .with_config()
        .limit(512_000)
        .read_json()
        .map_err(|_| Error::new("anki_response", "Invalid or oversized AnkiConnect response"))?;
    if !envelope.is_object() || envelope.get("error").is_none() || envelope.get("result").is_none()
    {
        return Err(Error::new("anki_response", "Invalid AnkiConnect envelope"));
    }
    if !envelope["error"].is_null() {
        return Err(Error::new(
            "anki_error",
            envelope["error"]
                .as_str()
                .unwrap_or("AnkiConnect error")
                .chars()
                .take(500)
                .collect::<String>(),
        ));
    }
    Ok(envelope["result"].clone())
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::TcpListener,
        thread,
    };
    #[test]
    fn card_images_allow_only_managed_media_without_attributes() {
        let filename = format!("foltra-{}.png", "a".repeat(64));
        assert!(safe_html(&format!("Question<br><img src=\"{filename}\">")));
        for value in [
            format!("<img src=\"{filename}\" onerror=\"alert(1)\">"),
            format!("<img src=\"../{filename}\">"),
            "<img src=\"https://example.com/a.png\">".into(),
            "<img src=\"data:image/png;base64,AAAA\">".into(),
            "<script>alert(1)</script>".into(),
        ] {
            assert!(!safe_html(&value));
        }
    }
    #[test]
    fn vault_image_upload_sends_verified_bytes_and_preserves_existing_media() {
        use base64::{engine::general_purpose::STANDARD, Engine};
        use std::io::Cursor;
        let dir = tempfile::tempdir().unwrap();
        crate::execute(
            dir.path().to_str().unwrap(),
            "vault.init",
            json!({"name":"Media QA"}),
        )
        .unwrap();
        let store = Store::open(dir.path().to_str().unwrap(), false).unwrap();
        let mut bytes = Cursor::new(Vec::new());
        image::DynamicImage::new_rgb8(2, 2)
            .write_to(&mut bytes, image::ImageFormat::Png)
            .unwrap();
        let encoded = STANDARD.encode(bytes.into_inner());
        let image = crate::attachments::import(&store, &json!({"data":encoded})).unwrap();
        let filename = format!(
            "foltra-{}",
            image["path"]
                .as_str()
                .unwrap()
                .strip_prefix("attachments/")
                .unwrap()
        );
        for (profile, returned, expected_error) in [
            ("QA", filename.clone(), None),
            ("Other", filename.clone(), Some("anki_profile")),
            ("QA", "collision.png".into(), Some("anki_media_conflict")),
        ] {
            let server = TcpListener::bind("127.0.0.1:0").unwrap();
            let port = server.local_addr().unwrap().port();
            let expected_filename = filename.clone();
            let expected_data = encoded.clone();
            let handle = thread::spawn(move || {
                for index in 0..if profile == "QA" { 2 } else { 1 } {
                    let (mut stream, _) = server.accept().unwrap();
                    stream
                        .set_read_timeout(Some(Duration::from_secs(3)))
                        .unwrap();
                    let mut request = Vec::new();
                    let (start, length) = loop {
                        let mut chunk = [0; 4096];
                        let count = stream.read(&mut chunk).unwrap();
                        assert!(count > 0);
                        request.extend_from_slice(&chunk[..count]);
                        if let Some(pos) = request.windows(4).position(|s| s == b"\r\n\r\n") {
                            let headers = String::from_utf8_lossy(&request[..pos]).to_lowercase();
                            let length: usize = headers
                                .lines()
                                .find_map(|line| line.strip_prefix("content-length: "))
                                .unwrap()
                                .parse()
                                .unwrap();
                            break (pos + 4, length);
                        }
                    };
                    while request.len() < start + length {
                        let mut chunk = [0; 4096];
                        let count = stream.read(&mut chunk).unwrap();
                        assert!(count > 0);
                        request.extend_from_slice(&chunk[..count]);
                    }
                    let request: Value =
                        serde_json::from_slice(&request[start..start + length]).unwrap();
                    let result = if index == 0 {
                        assert_eq!(request["action"], "getActiveProfile");
                        json!(profile)
                    } else {
                        assert_eq!(request["action"], "storeMediaFile");
                        assert_eq!(
                            request["params"],
                            json!({"filename":expected_filename,"data":expected_data,"deleteExisting":false})
                        );
                        json!(returned)
                    };
                    let body = json!({"result":result,"error":null}).to_string();
                    write!(
                        stream,
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                        body.len()
                    )
                    .unwrap();
                }
            });
            let result =
                store_vault_image_at(&store, &json!({"path":image["path"],"profile":"QA"}), port);
            if let Some(code) = expected_error {
                assert_eq!(result.unwrap_err().code, code);
            } else {
                assert_eq!(result.unwrap(), filename);
            }
            handle.join().unwrap();
        }
        assert_eq!(
            store_vault_image_at(&store, &json!({"path":"../private.png","profile":"QA"}), 0)
                .unwrap_err()
                .code,
            "invalid_path"
        );
        assert!(store_vault_image_at(
            &store,
            &json!({"path":image["path"],"profile":"QA","url":"https://example.com"}),
            0
        )
        .is_err());
    }
    #[test]
    fn card_faces_omit_metadata_for_new_and_legacy_packages() {
        for back in [CARD_BACK, LEGACY_CARD_BACK] {
            let params = json!({"modelName":"Foltra", "inOrderFields":["Front","Back","Source"], "cardTemplates":card_templates(back)});
            let actual = request_params("createModel", &params);
            assert!(validate("createModel", &actual).is_ok());
            assert_eq!(actual["cardTemplates"], card_templates(CARD_BACK));
            assert_eq!(actual["inOrderFields"], params["inOrderFields"]);
        }
        let custom = json!({"modelName":"Foltra", "inOrderFields":["Front","Back","Source"], "cardTemplates":card_templates("<script>bad()</script>")});
        assert!(validate("createModel", &request_params("createModel", &custom)).is_err());
        let fields = json!({"note":{"id":1,"fields":{"Source":"Foltra · Source"}}});
        assert_eq!(request_params("updateNoteFields", &fields), fields);
        let other = json!({"modelName":"Other", "cardTemplates":card_templates(LEGACY_CARD_BACK)});
        assert_eq!(request_params("createModel", &other), other);
    }
    #[test]
    fn no_destructive_media_or_script_actions() {
        for action in [
            "deleteNotes",
            "storeMediaFile",
            "multi",
            "loadProfile",
            "sync",
        ] {
            assert!(validate(action, &json!({})).is_err());
        }
        let note = json!({"id":1,"fields":{"Front":"<img src='https://evil.test/'>"}});
        assert!(validate("updateNoteFields", &json!({"note":note})).is_err());
        assert!(validate(
            "updateNoteFields",
            &json!({"note":{"id":1,"fields":{"Front":"&lt;img&gt;<br>안녕"}}})
        )
        .is_ok());
    }
    #[test]
    fn loopback_protocol_error_and_redirect_are_bounded() {
        for (status, body, success) in [
            ("200 OK", r#"{"result":6,"error":null}"#, true),
            ("200 OK", r#"{"result":null,"error":"invalid key"}"#, false),
            ("302 Found", "", false),
        ] {
            let server = TcpListener::bind("127.0.0.1:0").unwrap();
            let port = server.local_addr().unwrap().port();
            let handle = thread::spawn(move || {
                let (mut stream, _) = server.accept().unwrap();
                let mut request = [0; 8192];
                let _ = stream.read(&mut request).unwrap();
                write!(stream,"HTTP/1.1 {status}\r\nContent-Length: {}\r\nLocation: http://192.0.2.1/\r\nConnection: close\r\n\r\n{body}",body.len()).unwrap();
            });
            assert_eq!(request_at(port, "version", &json!({})).is_ok(), success);
            handle.join().unwrap();
        }
    }
}
