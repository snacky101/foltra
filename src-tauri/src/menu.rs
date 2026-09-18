use tauri::{
    menu::{AboutMetadata, Menu, SubmenuBuilder, HELP_SUBMENU_ID, WINDOW_SUBMENU_ID},
    AppHandle, Emitter, Manager,
};

pub fn create(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let name = app.config().product_name.as_deref().unwrap_or("Foltra");
    Menu::with_items(
        app,
        &[
            &SubmenuBuilder::new(app, name)
                .about(Some(AboutMetadata {
                    name: Some(name.into()),
                    version: Some(app.package_info().version.to_string()),
                    ..Default::default()
                }))
                .text("app.update", "Check for Updates…")
                .separator()
                .services()
                .separator()
                .hide()
                .hide_others()
                .separator()
                .quit()
                .build()?,
            // Native CloseWindow reserves Cmd+W before the configurable note command sees it.
            &SubmenuBuilder::new(app, "File")
                .text("window.close", "Close Window")
                .build()?,
            &SubmenuBuilder::new(app, "Edit")
                .undo()
                .redo()
                .separator()
                .cut()
                .copy()
                .paste()
                .select_all()
                .build()?,
            &SubmenuBuilder::new(app, "View").fullscreen().build()?,
            &SubmenuBuilder::with_id(app, WINDOW_SUBMENU_ID, "Window")
                .minimize()
                .maximize()
                .build()?,
            &SubmenuBuilder::with_id(app, HELP_SUBMENU_ID, "Help").build()?,
        ],
    )
}

pub fn handle(app: &AppHandle, event: tauri::menu::MenuEvent) {
    if event.id.as_ref() == "app.update" {
        app.state::<crate::updates::UpdateLifecycle>()
            .check_requested
            .store(true, std::sync::atomic::Ordering::SeqCst);
        if let Err(error) =
            crate::reopen_main_window(app).and_then(|_| app.emit("foltra:check-for-updates", ()))
        {
            eprintln!("Foltra could not open updates: {error}");
        }
    }
    if event.id.as_ref() == "window.close" {
        if let Some(window) = app.get_webview_window("main") {
            if let Err(error) = window.close() {
                eprintln!("Foltra could not close its window: {error}");
            }
        }
    }
}
