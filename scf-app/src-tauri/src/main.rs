// SPDX-License-Identifier: Apache-2.0
// No console window behind the app in a release build.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::process::ExitCode;

fn main() -> ExitCode {
    // `scf-editor mcp …` is an agent's MCP pipe, not the app: decided
    // before anything of the app starts, the single-instance check
    // included, which would otherwise hand the call to a running app.
    let mut args = std::env::args().skip(1);
    if args.next().as_deref() == Some("mcp") {
        return scf_editor_lib::mcp_pipe(args.collect());
    }
    scf_editor_lib::run();
    ExitCode::SUCCESS
}
