#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod cli_install;
#[cfg(target_os = "macos")]
mod menu;
mod open_paths;
mod updates;

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

#[cfg(target_os = "macos")]
fn notify_open_paths(app: &tauri::AppHandle) {
    use tauri::Emitter;

    if let Err(error) = reopen_main_window(app) {
        eprintln!("Foltra could not reopen its window: {error}");
    }
    if let Err(error) = app.emit("foltra:open-paths", ()) {
        eprintln!("Foltra could not notify its window about open paths: {error}");
    }
}

fn main() {
    let builder = tauri::Builder::default()
        .manage(updates::UpdateLifecycle::default())
        .manage(open_paths::PendingOpenPaths::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        )
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::SIZE
                        | tauri_plugin_window_state::StateFlags::POSITION
                        | tauri_plugin_window_state::StateFlags::MAXIMIZED,
                )
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            execute,
            open_paths::take_open_paths,
            updates::set_update_in_progress,
            updates::take_update_check_request,
            cli_install::cli_status,
            cli_install::install_cli
        ]);
    #[cfg(target_os = "macos")]
    let builder = builder.menu(menu::create).on_menu_event(menu::handle);
    #[cfg(target_os = "macos")]
    let mut app_ready = false;
    builder
        .build(tauri::generate_context!())
        .expect("Foltra could not start")
        .run(move |_app, _event| {
            use std::sync::atomic::Ordering;
            use tauri::Manager;
            if let tauri::RunEvent::ExitRequested { code, api, .. } = &_event {
                if updates::block_exit(
                    *code,
                    _app.state::<updates::UpdateLifecycle>()
                        .installing
                        .load(Ordering::SeqCst),
                ) {
                    api.prevent_exit();
                    return;
                }
            }
            #[cfg(target_os = "macos")]
            match _event {
                tauri::RunEvent::Ready => {
                    app_ready = true;
                    if _app.state::<open_paths::PendingOpenPaths>().has_pending() {
                        notify_open_paths(_app);
                    }
                }
                tauri::RunEvent::Opened { urls } => {
                    // macOS can send file-open events before Tauri creates main.
                    if _app.state::<open_paths::PendingOpenPaths>().enqueue(urls) && app_ready {
                        notify_open_paths(_app);
                    }
                }
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
