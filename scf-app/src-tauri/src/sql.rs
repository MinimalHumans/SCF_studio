// SPDX-License-Identifier: Apache-2.0
//! SQLite for the window: the `SqlExec` seam (scf-core `db.ts`) as Tauri
//! commands, so scf-core can run in the window against the `.scf` itself.
//!
//! A connection is a number the window holds. Values cross as JSON the
//! way the host's protocol already spells them (`SqlJson`): strings,
//! numbers, null, and `{ "$b64": … }` for a blob. Rows come back as
//! column names and value lists, which the window turns into objects;
//! that keeps column order and avoids naming every column on every row.
//!
//! The connection is set up to behave as `node:sqlite`'s does, because
//! that is what the files have been written with so far: foreign keys
//! enforced, double-quoted strings refused.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use rusqlite::config::DbConfig;
use rusqlite::types::{Value, ValueRef};
use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use serde_json::Value as Json;

/// The open connections. Cheap to clone: the window's socket
/// (`sql_socket.rs`) and the commands share one set.
#[derive(Clone, Default)]
pub struct Databases {
    next: Arc<AtomicU32>,
    open: Arc<Mutex<HashMap<u32, Arc<Mutex<Connection>>>>>,
}

impl Databases {
    fn get(&self, db: u32) -> Result<Arc<Mutex<Connection>>, String> {
        self.open
            .lock()
            .unwrap()
            .get(&db)
            .cloned()
            .ok_or_else(|| format!("no open database {db}"))
    }

    pub fn exec(&self, db: u32, sql: &str, params: Vec<Json>) -> Result<Rows, String> {
        let conn = self.get(db)?;
        let conn = conn.lock().unwrap();
        exec(&conn, sql, params)
    }
}

#[derive(Serialize)]
pub struct Rows {
    columns: Vec<String>,
    rows: Vec<Vec<Json>>,
}

fn param(v: Json) -> Result<Value, String> {
    Ok(match v {
        Json::Null => Value::Null,
        Json::Bool(b) => Value::Integer(b.into()),
        Json::Number(n) => match n.as_i64() {
            Some(i) => Value::Integer(i),
            None => Value::Real(n.as_f64().ok_or("number out of range")?),
        },
        Json::String(s) => Value::Text(s),
        Json::Object(o) => match o.get("$b64").and_then(Json::as_str) {
            Some(b) => Value::Blob(B64.decode(b).map_err(|e| e.to_string())?),
            None => return Err("an object parameter must be { $b64 }".into()),
        },
        Json::Array(_) => return Err("an array is not a parameter".into()),
    })
}

fn column(v: ValueRef) -> Json {
    match v {
        ValueRef::Null => Json::Null,
        ValueRef::Integer(i) => i.into(),
        ValueRef::Real(f) => f.into(),
        ValueRef::Text(t) => String::from_utf8_lossy(t).into_owned().into(),
        ValueRef::Blob(b) => serde_json::json!({ "$b64": B64.encode(b) }),
    }
}

fn open(path: &str, read_only: bool) -> rusqlite::Result<Connection> {
    let flags = if read_only {
        OpenFlags::SQLITE_OPEN_READ_ONLY
    } else {
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE
    } | OpenFlags::SQLITE_OPEN_NO_MUTEX;
    let conn = Connection::open_with_flags(path, flags)?;
    conn.set_db_config(DbConfig::SQLITE_DBCONFIG_ENABLE_FKEY, true)?;
    conn.set_db_config(DbConfig::SQLITE_DBCONFIG_DQS_DML, false)?;
    conn.set_db_config(DbConfig::SQLITE_DBCONFIG_DQS_DDL, false)?;
    conn.busy_timeout(Duration::from_secs(5))?;
    Ok(conn)
}

/// Every statement is stepped to the end, so one that returns no rows
/// (an INSERT) runs exactly as one that does (a SELECT, or RETURNING).
fn exec(conn: &Connection, sql: &str, params: Vec<Json>) -> Result<Rows, String> {
    let params = params
        .into_iter()
        .map(param)
        .collect::<Result<Vec<_>, _>>()?;
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let columns: Vec<String> = stmt.column_names().iter().map(|c| c.to_string()).collect();
    let mut cursor = stmt
        .query(rusqlite::params_from_iter(params))
        .map_err(|e| e.to_string())?;
    let mut rows = Vec::new();
    while let Some(row) = cursor.next().map_err(|e| e.to_string())? {
        rows.push(
            (0..columns.len())
                .map(|i| column(row.get_ref_unwrap(i)))
                .collect(),
        );
    }
    Ok(Rows { columns, rows })
}

#[tauri::command]
pub async fn sql_open(
    state: tauri::State<'_, Databases>,
    path: String,
    read_only: bool,
) -> Result<u32, String> {
    let conn = open(&path, read_only).map_err(|e| format!("{path}: {e}"))?;
    let id = state.next.fetch_add(1, Ordering::Relaxed) + 1;
    state
        .open
        .lock()
        .unwrap()
        .insert(id, Arc::new(Mutex::new(conn)));
    Ok(id)
}

#[tauri::command]
pub async fn sql_exec(
    state: tauri::State<'_, Databases>,
    db: u32,
    sql: String,
    params: Vec<Json>,
) -> Result<Rows, String> {
    state.exec(db, &sql, params)
}

#[tauri::command]
pub async fn sql_close(state: tauri::State<'_, Databases>, db: u32) -> Result<(), String> {
    let conn = state.open.lock().unwrap().remove(&db);
    match conn.map(Arc::try_unwrap) {
        None => Ok(()),
        Some(Ok(conn)) => conn
            .into_inner()
            .unwrap()
            .close()
            .map_err(|(_, e)| e.to_string()),
        // A statement still running holds it; it closes when that ends.
        Some(Err(_)) => Ok(()),
    }
}

/// Close everything. A page that reloads loses its host without closing
/// its films; the new one starts here so the old handles do not linger.
#[tauri::command]
pub async fn sql_reset(state: tauri::State<'_, Databases>) -> Result<(), String> {
    state.open.lock().unwrap().clear();
    Ok(())
}

/// A token that changes when the file does (scf-core `SessionDriver`).
#[tauri::command]
pub async fn file_fingerprint(path: String) -> Result<String, String> {
    let meta = std::fs::metadata(&path).map_err(|e| format!("{path}: {e}"))?;
    let modified = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map_or(0, |d| d.as_nanos());
    Ok(format!("{modified}:{}", meta.len()))
}
