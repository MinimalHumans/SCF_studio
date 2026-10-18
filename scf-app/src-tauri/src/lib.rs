// SPDX-License-Identifier: Apache-2.0
//! The desktop shell: a window, and the host it is a client of.
//!
//! The window talks to `scf-host` over the same loopback WebSocket it
//! uses in the browser (docs/scf-write-ownership.md); all the shell adds
//! is starting that host and telling the window where it is. The host is
//! the `scf-host` sidecar (tools/buildSidecar.mjs), started on the
//! window's first `host_location` and answered from then on.
//!
//! Under `tauri dev` the page is the Vite dev server's, which runs a host
//! of its own and never asks, so no sidecar is started.
//!
//! The shell keeps the host's stdin open for as long as it runs. When it
//! exits, or crashes, the pipe closes and the host exits once it has no
//! clients (`--exit-with-stdin`).

use std::io::{BufRead, BufReader, Read};
use std::path::PathBuf;
use std::process::{ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;

use serde::{Deserialize, Serialize};

/// The window's own origin, which the host must allow.
#[cfg(windows)]
const ORIGIN: &str = "http://tauri.localhost";
#[cfg(not(windows))]
const ORIGIN: &str = "tauri://localhost";

#[derive(Clone, Serialize)]
struct Location {
    url: String,
    token: String,
}

/// Why there is no location yet. `refused` means waiting will not help.
#[derive(Clone, Serialize)]
struct HostError {
    message: String,
    refused: bool,
}

#[derive(Default)]
enum State {
    #[default]
    NotStarted,
    Starting,
    Ready(Location),
    Failed(HostError),
}

#[derive(Default)]
struct Host {
    state: Mutex<State>,
    // Held, never written: closing it is how the host learns we are gone.
    stdin: Mutex<Option<ChildStdin>>,
}

/// The first line the host prints once it is listening.
#[derive(Deserialize)]
struct Listening {
    port: u16,
    token: String,
}

fn sidecar_path() -> std::io::Result<PathBuf> {
    // Tauri puts an `externalBin` beside the app's own executable, with
    // the target triple taken off.
    let exe = std::env::current_exe()?;
    let name = if cfg!(windows) { "scf-host.exe" } else { "scf-host" };
    Ok(exe.with_file_name(name))
}

fn start(host: Arc<Host>) -> Result<(), String> {
    let mut command = Command::new(sidecar_path().map_err(|e| e.to_string())?);
    command
        .args(["--origin", ORIGIN, "--replace-idle", "--exit-with-stdin"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = command
        .spawn()
        .map_err(|e| format!("could not start the SCF host: {e}"))?;
    *host.stdin.lock().unwrap() = child.stdin.take();
    let stdout = child.stdout.take().expect("stdout is piped");
    let mut stderr = child.stderr.take().expect("stderr is piped");

    thread::spawn(move || {
        let mut line = String::new();
        let _ = BufReader::new(stdout).read_line(&mut line);
        if let Ok(l) = serde_json::from_str::<Listening>(&line) {
            *host.state.lock().unwrap() = State::Ready(Location {
                url: format!("ws://127.0.0.1:{}/", l.port),
                token: l.token,
            });
        }
        // The host says why it could not start on stderr, and whatever
        // it says after that is for its log, which it keeps itself.
        let mut said = String::new();
        let _ = stderr.read_to_string(&mut said);
        let status = child.wait();
        let message = match said.trim() {
            "" => format!("the SCF host exited ({})", describe(status)),
            s => s.strip_prefix("scf-host: ").unwrap_or(s).to_string(),
        };
        *host.state.lock().unwrap() = State::Failed(HostError {
            message,
            refused: true,
        });
    });
    Ok(())
}

fn describe(status: std::io::Result<std::process::ExitStatus>) -> String {
    match status {
        Ok(s) => s.to_string(),
        Err(e) => e.to_string(),
    }
}

/// Where the host is, starting it on the first ask. Not ready yet is an
/// error the window retries; a host that could not start is `refused`.
#[tauri::command]
fn host_location(host: tauri::State<'_, Arc<Host>>) -> Result<Location, HostError> {
    let mut state = host.state.lock().unwrap();
    match &*state {
        State::Ready(l) => return Ok(l.clone()),
        State::Failed(e) => return Err(e.clone()),
        State::Starting => {}
        State::NotStarted => {
            *state = State::Starting;
            drop(state);
            if let Err(message) = start(Arc::clone(&host)) {
                let e = HostError { message, refused: true };
                *host.state.lock().unwrap() = State::Failed(e.clone());
                return Err(e);
            }
        }
    }
    Err(HostError {
        message: "the SCF host is starting".into(),
        refused: false,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Arc::new(Host::default()))
        .invoke_handler(tauri::generate_handler![host_location])
        .run(tauri::generate_context!())
        .expect("error while running the SCF editor");
}
