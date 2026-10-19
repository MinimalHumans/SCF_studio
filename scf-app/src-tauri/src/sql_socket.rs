// SPDX-License-Identifier: Apache-2.0
//! `sql_exec` over a loopback WebSocket, for the window.
//!
//! The same statements as the `sql_exec` command (`sql.rs`), on a
//! faster road: on Windows a Tauri `invoke` costs about a millisecond,
//! and scf-core awaits every statement, so a script import of a few
//! thousand statements spent seconds in transit. A socket the window
//! keeps open answers in a fraction of that. Opening and closing a
//! database stay commands; only the hot path moves.
//!
//!   → { "id": 1, "db": 1, "sql": "…", "params": [] }
//!   ← { "id": 1, "columns": [], "rows": [] }  or  { "id": 1, "error": "…" }
//!
//! Only a client that knows the token, which the window gets from the
//! `sql_socket` command, is let in.

use std::collections::hash_map::RandomState;
use std::hash::{BuildHasher, Hasher};

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::Value as Json;
use tokio::net::TcpListener;
use tokio_tungstenite::tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tokio_tungstenite::tungstenite::http::StatusCode;
use tokio_tungstenite::tungstenite::Message;

use crate::sql::Databases;

#[derive(Clone, Serialize)]
pub struct SqlSocket {
    url: String,
    token: String,
}

#[derive(Deserialize)]
struct Exec {
    id: u64,
    db: u32,
    sql: String,
    #[serde(default)]
    params: Vec<Json>,
}

fn token() -> String {
    // TODO: a real random source before this leaves the spike.
    (0..2)
        .map(|_| format!("{:016x}", RandomState::new().build_hasher().finish()))
        .collect()
}

fn answer(dbs: &Databases, text: &str) -> String {
    let reply = match serde_json::from_str::<Exec>(text) {
        Err(e) => serde_json::json!({ "id": null, "error": e.to_string() }),
        Ok(req) => match dbs.exec(req.db, &req.sql, req.params) {
            Ok(rows) => {
                let mut v = serde_json::to_value(rows).unwrap();
                v["id"] = req.id.into();
                v
            }
            Err(e) => serde_json::json!({ "id": req.id, "error": e }),
        },
    };
    reply.to_string()
}

/// Listen on a free loopback port, serving `dbs`.
pub fn start(dbs: Databases) -> std::io::Result<SqlSocket> {
    let listener = std::net::TcpListener::bind("127.0.0.1:0")?;
    listener.set_nonblocking(true)?;
    let socket = SqlSocket {
        url: format!("ws://{}/", listener.local_addr()?),
        token: token(),
    };
    let expected = format!("token={}", socket.token);
    tauri::async_runtime::spawn(async move {
        let listener = TcpListener::from_std(listener).expect("loopback listener");
        while let Ok((stream, _)) = listener.accept().await {
            let _ = stream.set_nodelay(true);
            let dbs = dbs.clone();
            let expected = expected.clone();
            tauri::async_runtime::spawn(async move {
                // tungstenite's callback type, not ours to shrink.
                #[allow(clippy::result_large_err)]
                let check = |req: &Request, res: Response| {
                    if req.uri().query() == Some(expected.as_str()) {
                        Ok(res)
                    } else {
                        let mut refused = ErrorResponse::new(None);
                        *refused.status_mut() = StatusCode::FORBIDDEN;
                        Err(refused)
                    }
                };
                let Ok(ws) = tokio_tungstenite::accept_hdr_async(stream, check).await else {
                    return;
                };
                let (mut tx, mut rx) = ws.split();
                while let Some(Ok(msg)) = rx.next().await {
                    let Message::Text(text) = msg else { continue };
                    if tx.send(Message::text(answer(&dbs, &text))).await.is_err() {
                        break;
                    }
                }
            });
        }
    });
    Ok(socket)
}

#[tauri::command]
pub fn sql_socket(socket: tauri::State<'_, SqlSocket>) -> SqlSocket {
    socket.inner().clone()
}
