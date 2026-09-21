use serde_json::{json, Value};

#[cfg(target_os = "macos")]
const DESTINATION: &str = "/usr/local/bin/foltra";

#[cfg(target_os = "macos")]
mod mac {
    use std::{
        fs, io,
        os::unix::fs::PermissionsExt,
        path::{Path, PathBuf},
    };

    pub fn bundled_cli(executable: &Path) -> Result<PathBuf, String> {
        let bin = executable.parent().ok_or("앱 위치를 확인할 수 없습니다.")?;
        let contents = bin.parent().ok_or("앱 위치를 확인할 수 없습니다.")?;
        let bundle = contents.parent().ok_or("앱 위치를 확인할 수 없습니다.")?;
        if bin.file_name().is_none_or(|name| name != "MacOS")
            || contents.file_name().is_none_or(|name| name != "Contents")
            || bundle.extension().is_none_or(|name| name != "app")
            || bundle.starts_with("/Volumes")
            || bundle
                .components()
                .any(|part| part.as_os_str() == "AppTranslocation")
        {
            return Err(
                "Foltra.app을 응용 프로그램 폴더로 옮겨 실행한 뒤 CLI를 설치하세요.".into(),
            );
        }
        let cli = bin.join("foltra");
        let metadata = fs::symlink_metadata(&cli)
            .map_err(|_| "앱에 CLI가 포함되어 있지 않습니다. 새 버전의 Foltra.app을 설치하세요.")?;
        if !metadata.is_file() || metadata.permissions().mode() & 0o111 == 0 {
            return Err("앱에 포함된 CLI 실행 파일이 올바르지 않습니다.".into());
        }
        Ok(cli)
    }

    pub fn installed(source: &Path, destination: &Path) -> Result<bool, String> {
        match fs::symlink_metadata(destination) {
            Ok(metadata)
                if metadata.file_type().is_symlink()
                    && fs::read_link(destination).ok().as_deref() == Some(source) =>
            {
                Ok(true)
            }
            Ok(_) => Err(format!(
                "{}에 다른 파일이나 링크가 있습니다. 기존 항목은 변경하지 않았습니다.",
                destination.display()
            )),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
            Err(error) => Err(error.to_string()),
        }
    }

    pub fn link(source: &Path, destination: &Path) -> io::Result<()> {
        fs::create_dir_all(destination.parent().expect("CLI destination has a parent"))?;
        std::os::unix::fs::symlink(source, destination)
    }

    pub fn install(source: &Path) -> Result<(), String> {
        let destination = Path::new(super::DESTINATION);
        if installed(source, destination)? {
            return Ok(());
        }
        match link(source, destination) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == io::ErrorKind::PermissionDenied => {
                // Only the app's own CLI is passed as a quoted argument. The fixed
                // destination is checked again under elevation, never overwritten.
                let script = r#"on run argv
do shell script "if [ -e /usr/local/bin/foltra ] || [ -L /usr/local/bin/foltra ]; then exit 17; fi; /bin/mkdir -p /usr/local/bin && /bin/ln -s " & quoted form of (item 1 of argv) & " /usr/local/bin/foltra" with administrator privileges
end run"#;
                let output = std::process::Command::new("/usr/bin/osascript")
                    .args(["-e", script, "--"])
                    .arg(source)
                    .output()
                    .map_err(|error| error.to_string())?;
                if !output.status.success() {
                    return Err("CLI 설치가 취소되었거나 권한을 얻지 못했습니다. 다시 설치를 눌러 시도하세요.".into());
                }
                if !installed(source, destination)? {
                    return Err("CLI 연결을 확인하지 못했습니다.".into());
                }
                Ok(())
            }
            Err(error) => Err(error.to_string()),
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn bundle_contains_an_executable_cli_and_rejects_temporary_or_nonbundle_paths() {
            let dir = tempfile::tempdir().unwrap();
            let bin = dir.path().join("한글 Foltra.app/Contents/MacOS");
            fs::create_dir_all(&bin).unwrap();
            let app = bin.join("foltra-desktop");
            assert!(bundled_cli(&app).is_err());
            let cli = bin.join("foltra");
            fs::write(&cli, b"cli").unwrap();
            fs::set_permissions(&cli, fs::Permissions::from_mode(0o644)).unwrap();
            assert!(bundled_cli(&app).is_err());
            fs::set_permissions(&cli, fs::Permissions::from_mode(0o755)).unwrap();
            assert_eq!(bundled_cli(&app).unwrap(), cli);
            for path in [
                "/target/debug/foltra-desktop",
                "/Volumes/Foltra/Foltra.app/Contents/MacOS/foltra-desktop",
                "/private/AppTranslocation/test/Foltra.app/Contents/MacOS/foltra-desktop",
            ] {
                assert!(bundled_cli(Path::new(path)).is_err());
            }
        }

        #[test]
        fn link_is_idempotent_and_follows_app_updates_without_overwriting_other_files() {
            let dir = tempfile::tempdir().unwrap();
            let source = dir.path().join("CLI with spaces");
            let destination = dir.path().join("bin/foltra");
            fs::write(&source, b"version one").unwrap();
            assert!(!installed(&source, &destination).unwrap());
            link(&source, &destination).unwrap();
            assert!(installed(&source, &destination).unwrap());
            fs::write(&source, b"version two").unwrap();
            assert_eq!(fs::read(&destination).unwrap(), b"version two");
            assert!(link(&source, &destination).is_err());
            fs::remove_file(&destination).unwrap();
            fs::write(&destination, b"existing tool").unwrap();
            assert!(installed(&source, &destination).is_err());
            assert!(link(&source, &destination).is_err());
            assert_eq!(fs::read(&destination).unwrap(), b"existing tool");
            fs::remove_file(&destination).unwrap();
            std::os::unix::fs::symlink(dir.path().join("missing"), &destination).unwrap();
            assert!(installed(&source, &destination).is_err());
            assert!(link(&source, &destination).is_err());
        }
    }
}

#[tauri::command]
pub fn cli_status() -> Value {
    #[cfg(target_os = "macos")]
    {
        let source = std::env::current_exe()
            .and_then(std::fs::canonicalize)
            .map_err(|error| error.to_string())
            .and_then(|path| mac::bundled_cli(&path));
        match source.and_then(|source| mac::installed(&source, std::path::Path::new(DESTINATION))) {
            Ok(installed) => {
                json!({"available": true, "installed": installed, "path": DESTINATION})
            }
            Err(message) => {
                json!({"available": false, "installed": false, "path": DESTINATION, "message": message})
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    json!({"available": false, "installed": false, "message": "앱에서 CLI 설치는 현재 macOS에서 지원합니다."})
}

#[tauri::command]
pub async fn install_cli() -> Result<Value, String> {
    #[cfg(target_os = "macos")]
    {
        tauri::async_runtime::spawn_blocking(|| {
            let executable = std::env::current_exe()
                .and_then(std::fs::canonicalize)
                .map_err(|error| error.to_string())?;
            mac::install(&mac::bundled_cli(&executable)?)?;
            Ok(cli_status())
        })
        .await
        .map_err(|error| error.to_string())?
    }
    #[cfg(not(target_os = "macos"))]
    Err("앱에서 CLI 설치는 현재 macOS에서 지원합니다.".into())
}
