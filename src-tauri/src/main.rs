#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[tauri::command]
async fn execute(
    vault: String,
    command: String,
    args: serde_json::Value,
) -> Result<serde_json::Value, foltra_core::Error> {
    tauri::async_runtime::spawn_blocking(move || foltra_core::execute(&vault, &command, args))
        .await
        .map_err(|e| foltra_core::Error::new("runtime", e.to_string()))?
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![execute])
        .run(tauri::generate_context!())
        .expect("Foltra could not start");
}
