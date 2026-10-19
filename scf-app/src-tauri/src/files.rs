// SPDX-License-Identifier: Apache-2.0
//! Files for the host core the window runs (scf-host `platform.ts`).
//!
//! Each command is one of the platform's file operations, done as
//! `nodePlatform.ts` does it in Node, so the host behaves the same in
//! either. Which folders a client may list or create in is the host
//! core's decision (its roots), not this module's.

use std::io::Write;
use std::path::{Path, PathBuf};

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use serde::Serialize;

fn err(path: &Path, e: impl std::fmt::Display) -> String {
    format!("{}: {e}", path.display())
}

/// How paths are spelled here, so the window can pick `windowsPaths`
/// or `posixPaths`.
#[tauri::command]
pub fn fs_windows() -> bool {
    cfg!(windows)
}

/// Absolute, links resolved; a path that does not exist yet is its
/// nearest existing ancestor's real spelling plus the rest.
#[tauri::command]
pub async fn fs_real(path: String) -> Result<String, String> {
    let mut probe = std::path::absolute(&path).map_err(|e| err(Path::new(&path), e))?;
    let mut tail: Vec<std::ffi::OsString> = Vec::new();
    while !probe.exists() {
        match (probe.file_name().map(|n| n.to_owned()), probe.parent()) {
            (Some(name), Some(parent)) => {
                tail.push(name);
                probe = parent.to_path_buf();
            }
            _ => break,
        }
    }
    let mut real = dunce::canonicalize(&probe).unwrap_or(probe);
    real.extend(tail.into_iter().rev());
    Ok(real.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn fs_exists(path: String) -> bool {
    Path::new(&path).exists()
}

#[derive(Serialize)]
pub struct DirEntry {
    name: String,
    kind: &'static str,
    size: u64,
    modified: String,
}

/// As JavaScript's `toISOString`: UTC, milliseconds, `Z`.
fn iso(t: std::time::SystemTime) -> String {
    chrono::DateTime::<chrono::Utc>::from(t).to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

/// A folder's entries, any that cannot be read left out.
#[tauri::command]
pub async fn fs_read_dir(path: String) -> Result<Vec<DirEntry>, String> {
    let dir = Path::new(&path);
    let mut out = Vec::new();
    for entry in std::fs::read_dir(dir).map_err(|e| err(dir, e))?.flatten() {
        // Followed, as Node's statSync follows links.
        let Ok(meta) = std::fs::metadata(entry.path()) else { continue };
        out.push(DirEntry {
            name: entry.file_name().to_string_lossy().into_owned(),
            kind: if meta.is_dir() {
                "dir"
            } else if meta.is_file() {
                "file"
            } else {
                "other"
            },
            size: meta.len(),
            modified: meta.modified().map(iso).unwrap_or_default(),
        });
    }
    Ok(out)
}

#[tauri::command]
pub async fn fs_read_text(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| err(Path::new(&path), e))
}

/// Append, making the folder if need be.
#[tauri::command]
pub async fn fs_append_text(path: String, text: String) -> Result<(), String> {
    let file = PathBuf::from(&path);
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir).map_err(|e| err(dir, e))?;
    }
    std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&file)
        .and_then(|mut f| f.write_all(text.as_bytes()))
        .map_err(|e| err(&file, e))
}

/// A new file holding these bytes; refuses if one is there.
#[tauri::command]
pub async fn fs_create_file(path: String, bytes: String) -> Result<(), String> {
    let file = Path::new(&path);
    let bytes = B64.decode(bytes).map_err(|e| err(file, e))?;
    std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(file)
        .and_then(|mut f| f.write_all(&bytes))
        .map_err(|e| err(file, e))
}

#[tauri::command]
pub async fn fs_mkdir(path: String) -> Result<(), String> {
    std::fs::create_dir_all(&path).map_err(|e| err(Path::new(&path), e))
}

/// Gone, if it was there. A file, as Node's `rmSync(path, { force })`.
#[tauri::command]
pub async fn fs_remove(path: String) -> Result<(), String> {
    match std::fs::remove_file(&path) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(err(Path::new(&path), e)),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::iso;
    use std::time::{Duration, UNIX_EPOCH};

    #[test]
    fn iso_matches_javascript() {
        // new Date(1792403456789).toISOString()
        let t = UNIX_EPOCH + Duration::from_millis(1_792_403_456_789);
        assert_eq!(iso(t), "2026-10-19T09:50:56.789Z");
        assert_eq!(iso(UNIX_EPOCH), "1970-01-01T00:00:00.000Z");
    }
}
