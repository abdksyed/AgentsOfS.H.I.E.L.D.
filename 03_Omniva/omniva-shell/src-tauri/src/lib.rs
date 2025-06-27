// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

use serde::Serialize;
use chrono::{DateTime, Utc};
use active_win_pos_rs::get_active_window;
use reqwest::blocking::Client;
use std::thread;
use std::time::Duration;

#[derive(Serialize)]
struct WindowPing {
    ts: DateTime<Utc>,
    app_name: String,
    title: String,
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {

    thread::spawn(|| {
        let client = Client::new();

        loop {
            if let Ok(info) = get_active_window() {
                let now = Utc::now();
                let ping = WindowPing {
                    ts: now,
                    app_name: info.app_name,
                    title: info.title,
                };
                
            }

        let res = client.post("http://localhost:8000/ping")
            .json(&ping)
            .send();

        if let Err(e) = res {
            eprintln!("Failed to send to API: {:?}", e);
        }

    } else {
        eprintln!("Failed to get active window: {:?}", e);
    }

    thread::sleep(Duration::from_secs(1));
    } 

    );
    
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
