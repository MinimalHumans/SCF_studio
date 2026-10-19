// SPDX-License-Identifier: Apache-2.0
//! The desktop shell: a window, and the host it is a client of.
//!
//! The window talks to `scf-host` over the same loopback WebSocket it
//! uses in the browser (docs/scf-write-ownership.md); all the shell adds
//! is telling the window where the host is. It asks `scf locate`, from the
//! `scf` sidecar (tools/scf.ts), which answers with the running host or
//! starts one — the same way the MCP (`scf mcp`, the same executable)
//! finds it, so whichever comes first starts the host and the other
//! joins. The shell owns no host: one started for it exits by itself a
//! while after its last client has gone.
//!
//! The window asks on every connect, so a host that has exited since is
//! replaced rather than retried. Under `tauri dev` the page is the Vite
//! dev server's, which runs a host of its own and never asks.

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![host_location])
        .run(tauri::generate_context!())
        .expect("error while running the SCF editor");
}
