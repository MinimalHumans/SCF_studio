// SPDX-License-Identifier: Apache-2.0
//! The desktop shell: a window, and what its host runs on.
//!
//! The window runs the host core itself (`src/host/windowHost.ts`); the
//! shell gives it SQLite (`sql`, `sql_socket`), files (`files`) and its
//! settings (`host_setup`). Agents reach it through `scf mcp`
//! (src/bin/scf.rs), whose lines the shell relays to the window
//! (`mcp_relay`).
//!
//! An agent can start the app: `scf mcp` runs it with `--background`, and
//! the window stays hidden. The app then lives as long as some agent is
//! connected, or until the person opens it, which shows the window. A
//! window closed while an agent is connected is only hidden, and the app
//! exits when the last one goes.

mod files;
mod mcp_relay;
mod sql;
mod sql_socket;
mod token;

use std::path::PathBuf;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Manager, RunEvent, WindowEvent};

/// What the window's own host is given (`src/host/windowHost.ts`).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HostSetup {
    /// Folders a client may browse and create files under:
    /// `SCF_HOST_ROOTS`, or else the user's home, and in a debug build
    /// the checkout's `fixtures/` and `templates/` too.
    roots: Vec<String>,
    /// Where snapshots and the journal are kept.
    data_dir: String,
    version: String,
}

#[tauri::command]
fn host_setup(app: AppHandle) -> Result<HostSetup, String> {
    let roots: Vec<PathBuf> = match std::env::var_os("SCF_HOST_ROOTS") {
        Some(v) if !v.is_empty() => std::env::split_paths(&v)
            .filter(|p| !p.as_os_str().is_empty())
            .collect(),
        _ => {
            let mut roots = vec![app.path().home_dir().map_err(|e| e.to_string())?];
            if cfg!(debug_assertions) {
                let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
                roots.extend(
                    ["fixtures", "templates"]
                        .map(|d| repo.join(d))
                        .into_iter()
                        .filter(|p| p.is_dir())
                        .filter_map(|p| dunce::canonicalize(p).ok()),
                );
            }
            roots
        }
    };
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let text = |p: PathBuf| p.to_string_lossy().into_owned();
    Ok(HostSetup {
        roots: roots.into_iter().map(text).collect(),
        data_dir: text(data_dir),
        version: app.package_info().version.to_string(),
    })
}

/// What `scf mcp` passes when it starts the app.
const BACKGROUND: &str = "--background";

/// How long a pipe-started app waits for its pipe, and a hidden app
/// whose last pipe has gone waits for another (an agent restarting its
/// servers), before it exits.
const LINGER: Duration = Duration::from_secs(20);

fn main_window(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    app.get_webview_window("main")
}

fn show(app: &AppHandle) {
    if let Some(w) = main_window(app) {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn hidden(app: &AppHandle) -> bool {
    main_window(app).is_none_or(|w| !w.is_visible().unwrap_or(false))
}

/// Exit in a while, if the window is still hidden and by then there has
/// been no pipe for that long.
fn exit_if_unused(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(LINGER).await;
        let idle = app.state::<mcp_relay::Relay>().idle_for();
        if hidden(&app) && idle.is_some_and(|d| d >= LINGER) {
            app.exit(0);
        }
    });
}

/// Where `scf mcp` looks for the app.
fn discovery_path(app: &AppHandle) -> tauri::Result<PathBuf> {
    Ok(app.path().app_data_dir()?.join("mcp.json"))
}

fn publish(app: &AppHandle, discovery: &mcp_relay::Discovery) -> tauri::Result<()> {
    let path = discovery_path(app)?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    // Whole or not at all: a pipe may be reading it as it is written.
    let partial = path.with_extension("json.partial");
    std::fs::write(&partial, serde_json::to_vec(discovery)?)?;
    std::fs::rename(&partial, &path)?;
    Ok(())
}

/// Take `mcp.json` down, if it is still this app's.
fn unpublish(app: &AppHandle) {
    let Ok(path) = discovery_path(app) else {
        return;
    };
    let ours = std::fs::read(&path)
        .ok()
        .and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok())
        .is_some_and(|v| v["pid"] == std::process::id());
    if ours {
        let _ = std::fs::remove_file(path);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let background = std::env::args().any(|a| a == BACKGROUND);
    let databases = sql::Databases::default();
    let socket = sql_socket::start(databases.clone()).expect("a loopback port for SQL");
    let relay = mcp_relay::Relay::new();
    let discovery = mcp_relay::start(relay.clone()).expect("a loopback port for the MCP");
    let builder = tauri::Builder::default()
        // First: a second start hands over here and goes no further.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // The person opening the app again wants to see it; a pipe
            // starting it needs only that it runs, which it does.
            if !argv.iter().any(|a| a == BACKGROUND) {
                show(app);
            }
        }))
        .manage(databases)
        .manage(socket)
        .manage(relay.clone())
        .setup(move |app| {
            let handle = app.handle().clone();
            publish(&handle, &discovery)?;
            if cfg!(debug_assertions) {
                // Beside an installed copy, which has its own data and pipe.
                if let Some(w) = main_window(&handle) {
                    let _ = w.set_title("SCF Editor (dev)");
                }
            }
            let on_count = handle.clone();
            relay.on_count(move |n| {
                if n == 0 && hidden(&on_count) {
                    exit_if_unused(&on_count);
                }
            });
            if background {
                exit_if_unused(&handle);
            } else {
                show(&handle);
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.state::<mcp_relay::Relay>().count() > 0 {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        });
    let builder = builder.invoke_handler(tauri::generate_handler![
        host_setup,
        sql::sql_open,
        sql::sql_close,
        sql::sql_reset,
        mcp_relay::mcp_listen,
        mcp_relay::mcp_send,
        mcp_relay::mcp_close,
        sql::file_fingerprint,
        sql_socket::sql_socket,
        files::fs_windows,
        files::fs_real,
        files::fs_exists,
        files::fs_read_dir,
        files::fs_stat,
        files::fs_read_text,
        files::fs_write_text,
        files::fs_append_text,
        files::fs_create_file,
        files::fs_mkdir,
        files::fs_remove,
    ]);
    builder
        .build(tauri::generate_context!())
        .expect("error while starting the SCF editor")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                unpublish(app);
            }
        });
}
