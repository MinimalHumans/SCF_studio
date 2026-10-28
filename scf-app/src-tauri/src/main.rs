// SPDX-License-Identifier: Apache-2.0
// No console window behind the app in a release build.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::ExitCode;

fn main() -> ExitCode {
    // `scf-editor mcp …` is an agent's MCP pipe, not the app: decided
    // before anything of the app starts, the single-instance check
    // included, which would otherwise hand the call to a running app.
    let mut args = std::env::args().skip(1);
    let first = args.next();
    if first.as_deref() == Some("mcp") {
        return scf_editor_lib::mcp_pipe(args.collect());
    }
    // An agent configured for the old Node server (`scf-editor server.js`)
    // is not asking for the app, and starting it would put a window on the
    // screen every time the agent starts. Say what to change instead.
    if let Some(script) = std::env::args().skip(1).find(|a| {
        let a = a.to_ascii_lowercase();
        a.ends_with(".js") || a.ends_with(".mjs") || a.ends_with(".cjs")
    }) {
        eprintln!(
            "scf-editor: {script} is not something this program runs. To connect an \
             assistant, point it at this executable with the single argument `mcp`."
        );
        return ExitCode::from(2);
    }
    scf_editor_lib::run();
    ExitCode::SUCCESS
}
