// SPDX-License-Identifier: Apache-2.0
//! The desktop shell: a window, and what its host runs on.
//!
//! The window runs the host core itself (`src/host/windowHost.ts`); the
//! shell gives it SQLite (`sql`, `sql_socket`), files (`files`) and its
//! settings (`host_setup`).
//!
//! `host_location` is left from when the window was a client of the
//! `scf` sidecar's host (tools/scf.ts), found or started by `scf
//! locate`. Nothing calls it now; it goes with the sidecar, once the MCP
//! no longer needs that host either.

mod files;
mod sql;
mod sql_socket;
#[cfg(any(debug_assertions, feature = "spike"))]
mod spike;

use std::path::PathBuf;
use std::process::Command;

use serde::{Deserialize, Serialize};

#[derive(Serialize)]
struct Location {
    url: String,
    token: String,
}

/// Why there is no location. The window shows the message; `refused`
/// tells it waiting will not help.
#[derive(Serialize)]
struct HostError {
    message: String,
    refused: bool,
}

/// What `scf locate` prints.
#[derive(Deserialize)]
struct Located {
    port: u16,
    token: String,
}

fn sidecar_path() -> std::io::Result<PathBuf> {
    // Tauri puts an `externalBin` beside the app's own executable, with
    // the target triple taken off.
    let exe = std::env::current_exe()?;
    let name = if cfg!(windows) { "scf.exe" } else { "scf" };
    Ok(exe.with_file_name(name))
}

fn locate() -> Result<Location, String> {
    let mut command = Command::new(sidecar_path().map_err(|e| e.to_string())?);
    command.arg("locate");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let out = command
        .output()
        .map_err(|e| format!("could not run the SCF host: {e}"))?;
    if !out.status.success() {
        let said = String::from_utf8_lossy(&out.stderr);
        let said = said.trim();
        return Err(match said.strip_prefix("scf-host: ") {
            Some(s) => s.to_string(),
            None if said.is_empty() => format!("scf locate failed ({})", out.status),
            None => said.to_string(),
        });
    }
    let l: Located = serde_json::from_slice(&out.stdout)
        .map_err(|e| format!("scf locate answered oddly: {e}"))?;
    Ok(Location {
        url: format!("ws://127.0.0.1:{}/", l.port),
        token: l.token,
    })
}

/// Where the host is, starting one if none is running.
#[tauri::command]
async fn host_location() -> Result<Location, HostError> {
    tauri::async_runtime::spawn_blocking(locate)
        .await
        .map_err(|e| e.to_string())
        .and_then(|r| r)
        .map_err(|message| HostError {
            message,
            refused: true,
        })
}

/// What the window's own host is given (`src/host/windowHost.ts`).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HostSetup {
    /// Folders a client may browse and create files under: as the Node
    /// host has them, `SCF_HOST_ROOTS` or else the user's home.
    roots: Vec<String>,
    /// Where snapshots and the journal are kept.
    data_dir: String,
    version: String,
}

#[tauri::command]
fn host_setup(app: tauri::AppHandle) -> Result<HostSetup, String> {
    use tauri::Manager;
    let roots: Vec<PathBuf> = match std::env::var_os("SCF_HOST_ROOTS") {
        Some(v) if !v.is_empty() => std::env::split_paths(&v)
            .filter(|p| !p.as_os_str().is_empty())
            .collect(),
        _ => vec![app.path().home_dir().map_err(|e| e.to_string())?],
    };
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let text = |p: PathBuf| p.to_string_lossy().into_owned();
    Ok(HostSetup {
        roots: roots.into_iter().map(text).collect(),
        data_dir: text(data_dir),
        version: app.package_info().version.to_string(),
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let databases = sql::Databases::default();
    let socket = sql_socket::start(databases.clone()).expect("a loopback port for SQL");
    let builder = tauri::Builder::default().manage(databases).manage(socket);
    #[cfg(any(debug_assertions, feature = "spike"))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        host_location,
        host_setup,
        sql::sql_open,
        sql::sql_exec,
        sql::sql_close,
        sql::sql_reset,
        sql::file_fingerprint,
        sql_socket::sql_socket,
        files::fs_windows,
        files::fs_real,
        files::fs_exists,
        files::fs_read_dir,
        files::fs_read_text,
        files::fs_append_text,
        files::fs_create_file,
        files::fs_mkdir,
        files::fs_remove,
        spike::spike_setup,
        spike::spike_copy,
        spike::spike_report,
    ]);
    #[cfg(not(any(debug_assertions, feature = "spike")))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        host_location,
        host_setup,
        sql::sql_open,
        sql::sql_exec,
        sql::sql_close,
        sql::sql_reset,
        sql::file_fingerprint,
        sql_socket::sql_socket,
        files::fs_windows,
        files::fs_real,
        files::fs_exists,
        files::fs_read_dir,
        files::fs_read_text,
        files::fs_append_text,
        files::fs_create_file,
        files::fs_mkdir,
        files::fs_remove,
    ]);
    builder
        .run(tauri::generate_context!())
        .expect("error while running the SCF editor");
}
