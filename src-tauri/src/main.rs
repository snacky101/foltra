#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(target_os = "macos")]
mod menu;

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

#[cfg(target_os = "macos")]
fn reopen_main_window(app: &tauri::AppHandle) -> tauri::Result<()> {
    use tauri::Manager;

    let window = match app.get_webview_window("main") {
        Some(window) => window,
        None => {
            let config = app
                .config()
                .app
                .windows
                .iter()
                .find(|config| config.label == "main")
                .expect("main window configuration is required");
            tauri::WebviewWindowBuilder::from_config(app, config)?.build()?
        }
    };
    window.unminimize()?;
    window.show()?;
    window.set_focus()
}

fn main() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::SIZE
                        | tauri_plugin_window_state::StateFlags::POSITION
                        | tauri_plugin_window_state::StateFlags::MAXIMIZED,
                )
                .build(),
        )
        .invoke_handler(tauri::generate_handler![execute]);
    #[cfg(target_os = "macos")]
    let builder = builder.menu(menu::create).on_menu_event(menu::handle);
    builder
        .build(tauri::generate_context!())
        .expect("Foltra could not start")
        .run(|_app, _event| {
            #[cfg(target_os = "macos")]
            match _event {
                // Closing the last window should leave the macOS app running.
                tauri::RunEvent::ExitRequested {
                    code: None, api, ..
                } => api.prevent_exit(),
                tauri::RunEvent::Reopen { .. } => {
                    if let Err(error) = reopen_main_window(_app) {
                        eprintln!("Foltra could not reopen its window: {error}");
                    }
                }
                _ => {}
            }
        });
}
