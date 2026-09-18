use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Default)]
pub struct UpdateLifecycle {
    pub installing: AtomicBool,
    pub check_requested: AtomicBool,
}

#[tauri::command]
pub fn set_update_in_progress(
    in_progress: bool,
    state: tauri::State<'_, UpdateLifecycle>,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    if in_progress {
        check_install_location()?;
    }
    state.installing.store(in_progress, Ordering::SeqCst);
    Ok(())
}

#[cfg(target_os = "macos")]
fn mac_bundle(executable: &std::path::Path) -> Result<&std::path::Path, String> {
    let error = || {
        "설치된 Foltra.app에서 업데이트를 실행하세요. 개발 실행 파일은 교체할 수 없습니다."
            .to_string()
    };
    let bin = executable.parent().ok_or_else(error)?;
    let contents = bin.parent().ok_or_else(error)?;
    let bundle = contents.parent().ok_or_else(error)?;
    if bin.file_name() != Some(std::ffi::OsStr::new("MacOS"))
        || contents.file_name() != Some(std::ffi::OsStr::new("Contents"))
        || bundle.extension() != Some(std::ffi::OsStr::new("app"))
    {
        return Err(error());
    }
    Ok(bundle)
}

#[cfg(target_os = "macos")]
fn check_install_location() -> Result<(), String> {
    use std::os::unix::fs::MetadataExt;
    let executable = std::env::current_exe()
        .and_then(std::fs::canonicalize)
        .map_err(|_| "실행 중인 앱의 위치를 확인하지 못했습니다.".to_string())?;
    let bundle = mac_bundle(&executable)?;
    let message =
        || "Foltra.app을 이 Mac의 응용 프로그램 폴더로 옮겨 실행한 뒤 업데이트하세요.".to_string();
    if bundle
        .components()
        .any(|part| part.as_os_str() == "AppTranslocation")
    {
        return Err(message());
    }
    let parent = bundle.parent().ok_or_else(message)?;
    // The SDK moves the app through the system temporary directory. Validate
    // writable placement and same-volume moves before it touches the bundle.
    let probe = tempfile::Builder::new()
        .prefix(".foltra-update-check-")
        .tempfile_in(parent)
        .map_err(|_| message())?;
    let destination = probe.as_file().metadata().map_err(|_| message())?;
    let temporary = std::fs::metadata(std::env::temp_dir()).map_err(|_| message())?;
    if destination.dev() != temporary.dev() {
        return Err(message());
    }
    Ok(())
}

#[tauri::command]
pub fn take_update_check_request(state: tauri::State<'_, UpdateLifecycle>) -> bool {
    state.check_requested.swap(false, Ordering::SeqCst)
}

pub fn block_exit(code: Option<i32>, installing: bool) -> bool {
    installing && code != Some(tauri::RESTART_EXIT_CODE)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn installation_blocks_window_exit_and_quit_but_allows_requested_restart() {
        assert!(block_exit(None, true));
        assert!(block_exit(Some(0), true));
        assert!(!block_exit(Some(tauri::RESTART_EXIT_CODE), true));
        assert!(!block_exit(None, false));
        assert!(!block_exit(Some(0), false));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn only_an_actual_bundle_layout_can_be_an_install_destination() {
        use std::path::Path;
        assert_eq!(
            mac_bundle(Path::new(
                "/Applications/Foltra.app/Contents/MacOS/foltra-desktop"
            ))
            .unwrap(),
            Path::new("/Applications/Foltra.app")
        );
        for path in [
            "/work/target/debug/foltra-desktop",
            "/work/Contents/MacOS/foltra-desktop",
            "/work/Foltra.app/Contents/MacOS-extra/foltra-desktop",
        ] {
            assert!(mac_bundle(Path::new(path)).is_err(), "{path}");
        }
    }
}
