// SPDX-License-Identifier: Apache-2.0
//! The MCP's way into the app: each agent's stdio pipe (`scf mcp`,
//! src/bin/scf.rs) connects here, and its lines are handed to the
//! window, which runs an MCP server for it beside the host
//! (`src/mcp/windowMcp.ts`).
//!
//! Lines, not parsed: an MCP message on stdio is one line of JSON, and
//! the window is what understands it. A pipe first says who it is,
//!
//!   → { "token": "…", "args": […], "cwd": "…", "readOnly": false, "elicit": true }
//!
//! and the window answers `{ "ok": true }` or `{ "error": "…" }` before
//! anything else. Where to connect, and the token, are in `mcp.json` in
//! the app's data folder, which only the user can read.
//!
//! A pipe that arrives before the window is listening waits for it. A
//! page that reloads loses the servers it was running, so a new listener
//! ends the pipes the last one had heard of; their agents start again.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc;

/// What `mcp.json` says.
#[derive(Serialize)]
pub struct Discovery {
    pub port: u16,
    pub token: String,
    pub pid: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Hello {
    token: String,
    #[serde(default)]
    args: Vec<String>,
    cwd: String,
    #[serde(default)]
    read_only: bool,
    #[serde(default = "yes")]
    elicit: bool,
}

fn yes() -> bool {
    true
}

/// What the window hears.
#[derive(Serialize, Clone)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum McpEvent {
    #[serde(rename_all = "camelCase")]
    Open {
        session: u32,
        args: Vec<String>,
        cwd: String,
        read_only: bool,
        elicit: bool,
    },
    Message {
        session: u32,
        line: String,
    },
    Closed {
        session: u32,
    },
}

enum Out {
    Line(String),
    End,
}

struct Session {
    out: mpsc::UnboundedSender<Out>,
    /// Told to a listener; until then its events wait in `held`.
    announced: bool,
    held: Vec<McpEvent>,
}

#[derive(Default)]
struct Inner {
    next: u32,
    listener: Option<Channel<McpEvent>>,
    sessions: HashMap<u32, Session>,
}

type OnCount = Box<dyn Fn(usize) + Send>;

/// The pipes connected now. Cheap to clone; every clone is the same.
#[derive(Clone)]
pub struct Relay {
    inner: Arc<Mutex<Inner>>,
    /// Called with the number of pipes whenever one comes or goes.
    on_count: Arc<Mutex<Option<OnCount>>>,
    /// Since when there has been no pipe; none while there is one.
    idle_since: Arc<Mutex<Option<Instant>>>,
}

impl Relay {
    pub fn new() -> Self {
        Self {
            inner: Arc::default(),
            on_count: Arc::default(),
            idle_since: Arc::new(Mutex::new(Some(Instant::now()))),
        }
    }

    pub fn count(&self) -> usize {
        self.inner.lock().unwrap().sessions.len()
    }

    /// How long there has been no pipe, if there is none now.
    pub fn idle_for(&self) -> Option<Duration> {
        self.idle_since.lock().unwrap().map(|t| t.elapsed())
    }

    pub fn on_count(&self, f: impl Fn(usize) + Send + 'static) {
        *self.on_count.lock().unwrap() = Some(Box::new(f));
    }

    fn counted(&self) {
        let n = self.count();
        {
            let mut idle = self.idle_since.lock().unwrap();
            *idle = match (n, *idle) {
                (0, None) => Some(Instant::now()),
                (0, since) => since,
                _ => None,
            };
        }
        if let Some(f) = self.on_count.lock().unwrap().as_ref() {
            f(n);
        }
    }

    /// Tell the window, or hold it for when there is one.
    fn emit(&self, session: u32, event: McpEvent) {
        let mut inner = self.inner.lock().unwrap();
        let listener = inner.listener.clone();
        let Some(s) = inner.sessions.get_mut(&session) else { return };
        match listener {
            Some(channel) if s.announced => {
                let _ = channel.send(event);
            }
            _ => s.held.push(event),
        }
    }

    fn add(&self, out: mpsc::UnboundedSender<Out>) -> u32 {
        let id = {
            let mut inner = self.inner.lock().unwrap();
            inner.next += 1;
            let id = inner.next;
            inner.sessions.insert(id, Session { out, announced: false, held: Vec::new() });
            id
        };
        self.counted();
        id
    }

    fn announce_held(&self) {
        let mut inner = self.inner.lock().unwrap();
        let Some(channel) = inner.listener.clone() else { return };
        for s in inner.sessions.values_mut().filter(|s| !s.announced) {
            s.announced = true;
            for event in s.held.drain(..) {
                let _ = channel.send(event);
            }
        }
    }

    fn remove(&self, session: u32) {
        let gone = self.inner.lock().unwrap().sessions.remove(&session);
        if let Some(s) = gone {
            let _ = s.out.send(Out::End);
            self.counted();
        }
    }

    /// A pipe has gone: forget it, and tell the window if it knew.
    fn closed(&self, session: u32) {
        let gone = self.inner.lock().unwrap().sessions.remove(&session);
        let Some(s) = gone else { return };
        if s.announced {
            if let Some(channel) = self.inner.lock().unwrap().listener.clone() {
                let _ = channel.send(McpEvent::Closed { session });
            }
        }
        self.counted();
    }
}

async fn serve(relay: Relay, stream: TcpStream, token: Arc<String>) {
    let (read, mut write) = stream.into_split();
    let mut lines = BufReader::new(read).lines();
    let hello = tokio::time::timeout(Duration::from_secs(10), lines.next_line()).await;
    let Ok(Ok(Some(hello))) = hello else { return };
    let Ok(hello) = serde_json::from_str::<Hello>(&hello) else { return };
    if hello.token != *token {
        return;
    }

    let (out, mut outgoing) = mpsc::unbounded_channel();
    let session = relay.add(out);
    tauri::async_runtime::spawn(async move {
        while let Some(Out::Line(line)) = outgoing.recv().await {
            if write.write_all(line.as_bytes()).await.is_err()
                || write.write_all(b"\n").await.is_err()
            {
                break;
            }
        }
        let _ = write.shutdown().await;
    });

    relay.emit(
        session,
        McpEvent::Open {
            session,
            args: hello.args,
            cwd: hello.cwd,
            read_only: hello.read_only,
            elicit: hello.elicit,
        },
    );
    relay.announce_held();
    while let Ok(Some(line)) = lines.next_line().await {
        relay.emit(session, McpEvent::Message { session, line });
    }
    relay.closed(session);
}

/// Listen on a free loopback port. What `mcp.json` should say comes back.
pub fn start(relay: Relay) -> std::io::Result<Discovery> {
    let listener = std::net::TcpListener::bind("127.0.0.1:0")?;
    listener.set_nonblocking(true)?;
    let discovery = Discovery {
        port: listener.local_addr()?.port(),
        token: crate::token::new()?,
        pid: std::process::id(),
    };
    let token = Arc::new(discovery.token.clone());
    tauri::async_runtime::spawn(async move {
        let listener = TcpListener::from_std(listener).expect("loopback listener");
        while let Ok((stream, _)) = listener.accept().await {
            let _ = stream.set_nodelay(true);
            tauri::async_runtime::spawn(serve(relay.clone(), stream, token.clone()));
        }
    });
    Ok(discovery)
}

/// The window is ready for pipes. Any it was serving before (a reload)
/// are ended; any waiting are announced.
#[tauri::command]
pub fn mcp_listen(relay: tauri::State<'_, Relay>, events: Channel<McpEvent>) {
    let stale: Vec<u32> = {
        let mut inner = relay.inner.lock().unwrap();
        inner.listener = Some(events);
        inner
            .sessions
            .iter()
            .filter(|(_, s)| s.announced)
            .map(|(id, _)| *id)
            .collect()
    };
    for id in stale {
        relay.remove(id);
    }
    relay.announce_held();
}

#[tauri::command]
pub fn mcp_send(relay: tauri::State<'_, Relay>, session: u32, line: String) {
    if let Some(s) = relay.inner.lock().unwrap().sessions.get(&session) {
        let _ = s.out.send(Out::Line(line));
    }
}

/// End a pipe, after whatever was sent to it.
#[tauri::command]
pub fn mcp_close(relay: tauri::State<'_, Relay>, session: u32) {
    relay.remove(session);
}
