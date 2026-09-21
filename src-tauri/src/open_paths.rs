use std::sync::Mutex;

// Keep paths until the frontend drains them, including during startup or while
// main is closed. Events only notify the frontend that this queue changed.
#[derive(Default)]
pub struct PendingOpenPaths(Mutex<Vec<String>>);

impl PendingOpenPaths {
    #[cfg(any(target_os = "macos", test))]
    pub fn enqueue(&self, urls: Vec<tauri::Url>) -> bool {
        let paths: Vec<String> = urls
            .into_iter()
            .filter(|url| url.scheme() == "file")
            .filter_map(|url| url.to_file_path().ok())
            .filter_map(|path| path.into_os_string().into_string().ok())
            .collect();
        if paths.is_empty() {
            return false;
        }
        self.0
            .lock()
            .expect("open path queue poisoned")
            .extend(paths);
        true
    }

    #[cfg(any(target_os = "macos", test))]
    pub fn has_pending(&self) -> bool {
        !self.0.lock().expect("open path queue poisoned").is_empty()
    }

    fn take(&self) -> Vec<String> {
        std::mem::take(&mut *self.0.lock().expect("open path queue poisoned"))
    }
}

#[tauri::command]
pub fn take_open_paths(state: tauri::State<'_, PendingOpenPaths>) -> Vec<String> {
    state.take()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file_url(path: &str) -> tauri::Url {
        tauri::Url::from_file_path(path).unwrap()
    }

    #[test]
    fn queued_paths_survive_until_an_atomic_drain_and_keep_event_order() {
        let pending = PendingOpenPaths::default();
        assert!(!pending.has_pending());
        assert!(pending.take().is_empty());

        assert!(pending.enqueue(vec![file_url("/tmp/first"), file_url("/tmp/second")]));
        assert!(pending.enqueue(vec![file_url("/tmp/third")]));
        assert!(pending.has_pending());
        assert_eq!(pending.take(), ["/tmp/first", "/tmp/second", "/tmp/third"]);
        assert!(!pending.has_pending());
        assert!(pending.take().is_empty());

        assert!(pending.enqueue(vec![file_url("/tmp/after-drain")]));
        assert_eq!(pending.take(), ["/tmp/after-drain"]);
    }

    #[test]
    fn file_urls_decode_spaces_unicode_and_reserved_path_characters() {
        let pending = PendingOpenPaths::default();
        let path = "/tmp/한글 vault/notes/100% #?.md";
        assert!(pending.enqueue(vec![file_url(path)]));
        assert_eq!(pending.take(), [path]);
    }

    #[test]
    fn non_file_urls_do_not_queue_or_request_a_window() {
        let pending = PendingOpenPaths::default();
        let urls = [
            "https://example.com/note.md",
            "https://localhost/note.md",
            "foltra://open/vault",
            "foltra:///tmp/vault",
        ]
        .into_iter()
        .map(|url| tauri::Url::parse(url).unwrap())
        .collect();
        assert!(!pending.enqueue(urls));
        assert!(!pending.has_pending());
        assert!(pending.take().is_empty());
    }
}
