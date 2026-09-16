use crate::{storage::Store, text, Error, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use image::{ImageFormat, ImageReader};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::io::Cursor;

pub const MAX_BYTES: usize = 10 * 1024 * 1024;

fn invalid() -> Error {
    Error::new(
        "invalid_image",
        "PNG, JPEG, GIF, WebP 이미지만 붙여넣을 수 있습니다 (최대 10 MiB, 4천만 픽셀).",
    )
}

fn decode(encoded: &str) -> Result<Vec<u8>> {
    if encoded.len() > MAX_BYTES.div_ceil(3) * 4 {
        return Err(invalid());
    }
    let bytes = STANDARD.decode(encoded).map_err(|_| invalid())?;
    if bytes.is_empty() || bytes.len() > MAX_BYTES {
        return Err(invalid());
    }
    Ok(bytes)
}

fn describe(bytes: &[u8]) -> Result<Value> {
    let format = image::guess_format(bytes).map_err(|_| invalid())?;
    let extension = match format {
        ImageFormat::Png => "png",
        ImageFormat::Jpeg => "jpg",
        ImageFormat::Gif => "gif",
        ImageFormat::WebP => "webp",
        _ => return Err(invalid()),
    };
    let mut reader = ImageReader::with_format(Cursor::new(bytes), format);
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(16384);
    limits.max_image_height = Some(16384);
    limits.max_alloc = Some(64 * 1024 * 1024);
    reader.limits(limits);
    let (width, height) = reader.into_dimensions().map_err(|_| invalid())?;
    if width == 0 || height == 0 || u64::from(width) * u64::from(height) > 40_000_000 {
        return Err(invalid());
    }
    let path = format!("attachments/{:x}.{extension}", Sha256::digest(bytes));
    Ok(
        json!({"path":path,"mimeType":format.to_mime_type(),"size":bytes.len(),"width":width,"height":height}),
    )
}

fn valid_path(path: &str) -> bool {
    let Some((hash, extension)) = path
        .strip_prefix("attachments/")
        .and_then(|p| p.rsplit_once('.'))
    else {
        return false;
    };
    hash.len() == 64
        && hash
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        && ["png", "jpg", "gif", "webp"].contains(&extension)
}

pub fn decode_entry(path: &str, encoded: &str) -> Result<Vec<u8>> {
    if !valid_path(path) {
        return Err(invalid());
    }
    let bytes = decode(encoded)?;
    if describe(&bytes)?["path"] != path {
        return Err(invalid());
    }
    Ok(bytes)
}

pub fn import(store: &Store, args: &Value) -> Result<Value> {
    let bytes = decode(text(args, "data")?)?;
    let metadata = describe(&bytes)?;
    let path = metadata["path"].as_str().unwrap();
    match store.read_bytes(path, MAX_BYTES) {
        Ok(existing) if existing == bytes => return Ok(metadata),
        Ok(_) => {
            return Err(Error::new(
                "attachment_conflict",
                "Existing attachment was changed; it has not been overwritten",
            ))
        }
        Err(e) if e.code == "not_found" => {}
        Err(e) => return Err(e),
    }
    store.commit_with_binary(vec![], vec![(path.to_string(), bytes)])?;
    Ok(metadata)
}

pub fn read(store: &Store, args: &Value) -> Result<Value> {
    let path = text(args, "path")?;
    if !valid_path(path) {
        return Err(Error::new(
            "invalid_path",
            "Only managed vault attachments can be read",
        ));
    }
    let bytes = store.read_bytes(path, MAX_BYTES)?;
    let mut metadata = describe(&bytes)?;
    if metadata["path"] != path {
        return Err(Error::new(
            "attachment_conflict",
            "Attachment content does not match its name",
        ));
    }
    metadata["data"] = json!(STANDARD.encode(bytes));
    Ok(metadata)
}

pub fn export(store: &Store) -> Result<Map<String, Value>> {
    let mut files = Map::new();
    for extension in ["png", "jpg", "gif", "webp"] {
        for path in store.files("attachments", extension)? {
            let image = read(store, &json!({"path":path}))?;
            files.insert(path, image["data"].clone());
        }
    }
    Ok(files)
}
