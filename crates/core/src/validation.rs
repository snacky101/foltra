use crate::{Error, Result};

pub(crate) fn pretty(value: &impl serde::Serialize) -> Result<String> {
    Ok(serde_json::to_string_pretty(value)? + "\n")
}

pub(crate) fn nonempty(value: &str, label: &str) -> Result<String> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > 240 {
        return Err(Error::new(
            "invalid_arguments",
            format!("{label} must contain 1–240 characters"),
        ));
    }
    Ok(value.into())
}

pub(crate) fn check_revision(expected: &str, actual: &str) -> Result<()> {
    if expected != actual {
        return Err(Error::new("conflict", "This item changed elsewhere. Your edit has not overwritten it. Reload or keep a separate copy."));
    }
    Ok(())
}

// Same persisted key spelling as the GUI recorder; old literal leader characters remain valid.
pub(crate) fn valid_leader_key(value: &str) -> bool {
    static PRINTABLE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let printable = |s: &str| {
        PRINTABLE
            .get_or_init(|| regex::Regex::new(r"\A[^\p{Cc}\p{Cf}]\z").unwrap())
            .is_match(s)
    };
    if printable(value) {
        return true;
    }
    let mut key = value;
    for prefix in ["Ctrl+", "Meta+", "Alt+", "Shift+"] {
        if let Some(rest) = key.strip_prefix(prefix) {
            key = rest;
        }
    }
    printable(key)
        || [
            "Space",
            "Enter",
            "Backspace",
            "Delete",
            "Insert",
            "Home",
            "End",
            "PageUp",
            "PageDown",
            "ArrowLeft",
            "ArrowRight",
            "ArrowUp",
            "ArrowDown",
        ]
        .contains(&key)
        || key.strip_prefix('F').is_some_and(|n| {
            n.bytes().all(|b| b.is_ascii_digit())
                && n.parse::<u8>().is_ok_and(|n| (1..=24).contains(&n))
                && !n.starts_with('0')
        })
}
