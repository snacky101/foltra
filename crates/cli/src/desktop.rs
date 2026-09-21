use foltra_core::{Error, Result};
use serde_json::{json, Value};

#[cfg(any(target_os = "macos", test))]
use std::{ffi::OsString, path::Path};

#[cfg(any(target_os = "macos", test))]
fn open_args(
    target: &str,
    executable: &Path,
    override_app: Option<OsString>,
) -> Result<Vec<OsString>> {
    let app = if let Some(path) = override_app {
        let path = std::path::PathBuf::from(path);
        if !path.is_dir() {
            return Err(Error::new(
                "invalid_app_path",
                "FOLTRA_APP_PATH must point to a Foltra.app directory",
            ));
        }
        Some(std::fs::canonicalize(path)?)
    } else {
        executable.parent().and_then(|parent| {
            if parent.file_name().is_some_and(|name| name == "MacOS") {
                let contents = parent.parent()?;
                let bundle = contents.parent()?;
                if contents.file_name().is_some_and(|name| name == "Contents")
                    && bundle.extension().is_some_and(|name| name == "app")
                {
                    return Some(bundle.to_path_buf());
                }
            }
            if !parent
                .file_name()
                .is_some_and(|name| name == "debug" || name == "release")
            {
                return None;
            }
            let app = parent.join("bundle/macos/Foltra.app");
            app.is_dir().then_some(app)
        })
    };
    Ok(if let Some(app) = app {
        vec!["-a".into(), app.into_os_string(), target.into()]
    } else {
        vec!["-b".into(), "app.foltra.desktop".into(), target.into()]
    })
}

pub fn open(path: &str) -> Result<Value> {
    let target = foltra_core::execute("", "path.resolve", json!({"path":path}))?;
    #[cfg(target_os = "macos")]
    {
        let arguments = open_args(
            target["path"].as_str().unwrap(),
            &std::fs::canonicalize(std::env::current_exe()?)?,
            std::env::var_os("FOLTRA_APP_PATH"),
        )?;
        let output = std::process::Command::new("/usr/bin/open")
            .args(arguments)
            .output()?;
        if !output.status.success() {
            return Err(Error::new(
                "desktop_launch_failed",
                format!(
                    "Could not open Foltra. Install Foltra.app or set FOLTRA_APP_PATH. {}",
                    String::from_utf8_lossy(&output.stderr).trim()
                ),
            ));
        }
        let mut result = target;
        result["opened"] = json!(true);
        Ok(result)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = target;
        Err(Error::new(
            "unsupported_platform",
            "Opening the desktop app from the CLI currently requires macOS. Open the vault in Foltra manually or use --vault PATH with a headless command.",
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn launcher_preserves_special_characters_as_one_argument() {
        let target = "/vault/한글 space;$(touch injected)/notes/123.md";
        assert_eq!(
            open_args(target, Path::new("/usr/local/bin/foltra"), None).unwrap(),
            vec![
                OsString::from("-b"),
                OsString::from("app.foltra.desktop"),
                OsString::from(target)
            ]
        );
    }

    #[test]
    fn bundled_cli_opens_its_own_app_after_symlink_resolution() {
        let executable = Path::new("/Applications/My Foltra.app/Contents/MacOS/foltra");
        assert_eq!(
            open_args("/vault", executable, None).unwrap(),
            vec![
                OsString::from("-a"),
                OsString::from("/Applications/My Foltra.app"),
                OsString::from("/vault")
            ]
        );
    }

    #[test]
    fn local_bundle_and_explicit_override_are_selected_without_launching() {
        let dir = tempfile::tempdir().unwrap();
        let executable = dir.path().join("target/debug/foltra");
        let bundle = dir.path().join("target/debug/bundle/macos/Foltra.app");
        std::fs::create_dir_all(&bundle).unwrap();
        assert_eq!(
            open_args("/vault", &executable, None).unwrap(),
            vec![
                OsString::from("-a"),
                bundle.into_os_string(),
                "/vault".into()
            ]
        );
        let custom = dir.path().join("Custom Foltra.app");
        std::fs::create_dir(&custom).unwrap();
        let args = open_args("/vault", &executable, Some(custom.clone().into_os_string())).unwrap();
        assert_eq!(
            args[1],
            std::fs::canonicalize(&custom).unwrap().into_os_string()
        );
        std::fs::remove_dir(custom).unwrap();
        assert_eq!(
            open_args(
                "/vault",
                &executable,
                Some(dir.path().join("missing").into_os_string())
            )
            .unwrap_err()
            .code,
            "invalid_app_path"
        );
    }
}
