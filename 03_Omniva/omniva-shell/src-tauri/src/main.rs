// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use chrono::{DateTime, Utc};

#[derive(Serialize)]
struct WindowPing {
    ts: DateTime<Utc>,
    app_name: String,
    title: String,
}

fn main() {
    omniva_shell_lib::run()
}
