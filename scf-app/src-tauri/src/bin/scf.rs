// SPDX-License-Identifier: Apache-2.0
//! `scf mcp [options]`: the SCF editor's MCP server, on stdio, for an
//! agent to start.
//!
//! The server itself runs in the editor's window (src/mcp_relay.rs); this
//! is a pipe to it. It finds the running app through `mcp.json` in the
//! app's data folder, or starts it in the background and waits for it,
//! says who it is, and from then on copies stdin to the app and the
//! app's answers to stdout. Its options are scf-mcp's own, and are the
//! app's to judge; so are SCF_MCP_READ_ONLY and SCF_MCP_ELICIT.
//!
//! Shipped beside the app's executable, which is how it finds it to
//! start; SCF_EDITOR_EXE names another.

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{Shutdown, TcpStream};
use std::path::PathBuf;
use std::process::{Command, ExitCode, Stdio};
use std::time::{Duration, Instant};

/// The app's identifier (tauri.conf.json), which names its data folder.
const IDENTIFIER: &str = "com.minimalhumans.scf-editor";

/// How long a started app has to be ready.
const START_TIMEOUT: Duration = Duration::from_secs(60);

const USAGE: &str = "usage: scf mcp [options]   the SCF MCP server on stdio";

fn fail(message: impl std::fmt::Display) -> ExitCode {
    eprintln!("scf: {message}");
    ExitCode::FAILURE
}

fn discovery_path() -> Option<PathBuf> {
    Some(dirs::data_dir()?.join(IDENTIFIER).join("mcp.json"))
}

/// Connected to the running app, and the token it wants.
fn connect() -> Option<(TcpStream, String)> {
    let text = std::fs::read(discovery_path()?).ok()?;
    let found: serde_json::Value = serde_json::from_slice(&text).ok()?;
    let port = u16::try_from(found["port"].as_u64()?).ok()?;
    let token = found["token"].as_str()?.to_string();
    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
    let stream = TcpStream::connect_timeout(&addr, Duration::from_secs(2)).ok()?;
    Some((stream, token))
}

fn editor_exe() -> std::io::Result<PathBuf> {
    if let Some(exe) = std::env::var_os("SCF_EDITOR_EXE") {
        return Ok(exe.into());
    }
    let name = if cfg!(windows) { "scf-editor.exe" } else { "scf-editor" };
    Ok(std::env::current_exe()?.with_file_name(name))
}

/// Start the app in the background, detached from this process: its
/// output must not land in the agent's protocol stream, and it outlives
/// this pipe.
fn start_app() -> std::io::Result<()> {
    let mut command = Command::new(editor_exe()?);
    command
        .arg("--background")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        command.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);
        keep_stdio_to_ourselves();
    }
    #[cfg(unix)]
    {
        // Not in the agent's process group, whose signals are for us.
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    command.spawn().map(|_| ())
}

/// Windows gives a child every inheritable handle its parent has, and
/// this pipe's stdio is inheritable. Were the app to keep a copy of our
/// stdout, the agent would not see it close until the app exits.
#[cfg(windows)]
fn keep_stdio_to_ourselves() {
    use std::ffi::c_void;
    #[link(name = "kernel32")]
    extern "system" {
        fn GetStdHandle(which: u32) -> *mut c_void;
        fn SetHandleInformation(handle: *mut c_void, mask: u32, flags: u32) -> i32;
    }
    const HANDLE_FLAG_INHERIT: u32 = 1;
    // STD_INPUT_HANDLE, STD_OUTPUT_HANDLE, STD_ERROR_HANDLE: -10, -11, -12.
    for which in [-10i32, -11, -12] {
        // SAFETY: both take any handle value, and fail harmlessly on one
        // that is not open.
        unsafe {
            SetHandleInformation(GetStdHandle(which as u32), HANDLE_FLAG_INHERIT, 0);
        }
    }
}

fn connect_or_start() -> Result<(TcpStream, String), String> {
    if let Some(found) = connect() {
        return Ok(found);
    }
    start_app().map_err(|e| format!("could not start the SCF editor: {e}"))?;
    let deadline = Instant::now() + START_TIMEOUT;
    while Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(200));
        if let Some(found) = connect() {
            return Ok(found);
        }
    }
    Err("the SCF editor did not start in time".into())
}

fn main() -> ExitCode {
    let mut args = std::env::args().skip(1);
    if args.next().as_deref() != Some("mcp") {
        eprintln!("{USAGE}");
        return ExitCode::from(2);
    }
    let args: Vec<String> = args.collect();

    let (stream, token) = match connect_or_start() {
        Ok(found) => found,
        Err(e) => return fail(e),
    };
    let _ = stream.set_nodelay(true);
    let cwd = std::env::current_dir()
        .map(|d| d.to_string_lossy().into_owned())
        .unwrap_or_default();
    let env = |name: &str| std::env::var(name).ok();
    let hello = serde_json::json!({
        "token": token,
        "args": args,
        "cwd": cwd,
        "readOnly": env("SCF_MCP_READ_ONLY").as_deref() == Some("1"),
        "elicit": env("SCF_MCP_ELICIT").as_deref() != Some("0"),
    });
    let mut to_app = match stream.try_clone() {
        Ok(s) => s,
        Err(e) => return fail(e),
    };
    if let Err(e) = writeln!(to_app, "{hello}") {
        return fail(format!("the SCF editor went away: {e}"));
    }

    // Its first line is whether it will serve us.
    let mut from_app = BufReader::new(stream);
    let mut answer = String::new();
    if from_app.read_line(&mut answer).unwrap_or(0) == 0 {
        return fail("the SCF editor closed the connection");
    }
    let answer: serde_json::Value = serde_json::from_str(&answer).unwrap_or_default();
    if answer["ok"] != true {
        let said = answer["error"].as_str().unwrap_or("the SCF editor refused");
        eprint!("{said}");
        if !said.ends_with('\n') {
            eprintln!();
        }
        return ExitCode::FAILURE;
    }

    // The agent's messages to the app, until the agent is done.
    std::thread::spawn(move || {
        let _ = std::io::copy(&mut std::io::stdin().lock(), &mut to_app);
        let _ = to_app.shutdown(Shutdown::Write);
    });

    // And the app's to the agent, each as soon as it comes.
    let mut out = std::io::stdout().lock();
    let mut buf = [0u8; 64 * 1024];
    loop {
        match from_app.read(&mut buf) {
            Ok(0) | Err(_) => break,
            Ok(n) => {
                if out.write_all(&buf[..n]).and_then(|()| out.flush()).is_err() {
                    break;
                }
            }
        }
    }
    ExitCode::SUCCESS
}
