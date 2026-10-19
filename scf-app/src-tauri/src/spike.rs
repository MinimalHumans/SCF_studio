// SPDX-License-Identifier: Apache-2.0
//! The in-app host spike's harness (scf-app/spike.html): copies of the
//! conformance fixture to work on, the files to compare against, and a
//! way to print the result and exit. Debug builds, or `--features spike`.

use std::path::PathBuf;

use serde::Serialize;
use tauri::Manager;

fn repo() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Setup {
    work: String,
    report_json: String,
    fountain: String,
}

fn read(path: PathBuf) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("{}: {e}", path.display()))
}

/// A fresh folder holding `fixture-tauri.scf` and `fixture-node.scf`.
#[tauri::command]
pub async fn spike_setup() -> Result<Setup, String> {
    let work = std::env::temp_dir().join(format!("scf-spike-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&work);
    std::fs::create_dir_all(&work).map_err(|e| e.to_string())?;
    let fixture = repo().join("fixtures").join("hollow_creek.scf");
    for side in ["tauri", "node"] {
        std::fs::copy(&fixture, work.join(format!("fixture-{side}.scf")))
            .map_err(|e| e.to_string())?;
    }
    Ok(Setup {
        work: work.to_string_lossy().into_owned(),
        report_json: read(repo().join("fixtures").join("hollow_creek.report.json"))?,
        fountain: read(repo().join("corpus/public/scripts/alexis-nexus.fountain"))?,
    })
}

#[tauri::command]
pub async fn spike_copy(from: String, to: String) -> Result<(), String> {
    std::fs::copy(&from, &to)
        .map(|_| ())
        .map_err(|e| format!("{from}: {e}"))
}

/// Print what the spike found and close the app.
#[tauri::command]
pub fn spike_report(app: tauri::AppHandle, text: String) {
    println!("{text}");
    if std::env::var_os("SCF_SPIKE_KEEP_OPEN").is_none() {
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.close();
        }
        app.exit(0);
    }
}
