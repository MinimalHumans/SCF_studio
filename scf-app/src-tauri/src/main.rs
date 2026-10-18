// SPDX-License-Identifier: Apache-2.0
// No console window behind the app in a release build.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    scf_editor_lib::run()
}
