use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    pub width: u32,
    pub height: u32,
    pub resizable: bool,
    pub fullscreen: bool,
    pub hide_title_bar: bool,
    pub always_on_top: bool,
    pub dark_mode: bool,
    pub show_system_tray: bool,
    pub inject_css: String,
    pub inject_js: String,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            url: String::new(),
            name: None,
            width: 1200,
            height: 780,
            resizable: true,
            fullscreen: false,
            hide_title_bar: false,
            always_on_top: false,
            dark_mode: false,
            show_system_tray: false,
            inject_css: String::new(),
            inject_js: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub name: String,
    pub url: String,
    pub config: AppConfig,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildProgress {
    pub status: String,
    pub message: String,
    pub app_name: String,
    pub progress_pct: u8,
}

fn get_profiles_dir() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    home.join(".pake").join("profiles")
}

#[tauri::command]
async fn list_profiles() -> Result<Vec<Profile>, String> {
    let dir = get_profiles_dir();
    if !dir.exists() {
        return Ok(vec![]);
    }

    let mut profiles = Vec::new();
    let entries = std::fs::read_dir(&dir).map_err(|e| e.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.extension().map_or(false, |ext| ext == "json") {
            let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
            if let Ok(profile) = serde_json::from_str::<Profile>(&content) {
                profiles.push(profile);
            }
        }
    }
    Ok(profiles)
}

#[tauri::command]
async fn save_profile(name: String, url: String, config: AppConfig) -> Result<(), String> {
    let dir = get_profiles_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let profile = Profile {
        name: name.clone(),
        url,
        config,
        created_at: {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();
            format!("{}", now)
        },
    };

    let path = dir.join(format!("{}.json", name));
    let content = serde_json::to_string_pretty(&profile).map_err(|e| e.to_string())?;
    std::fs::write(path, content).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn delete_profile(name: String) -> Result<(), String> {
    let path = get_profiles_dir().join(format!("{}.json", name));
    if path.exists() {
        std::fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn build_app(window: tauri::Window, config: AppConfig) -> Result<String, String> {
    let app_name = config.name.clone().unwrap_or_else(|| "pake-app".to_string());

    // Build the pake CLI command
    let mut args: Vec<String> = vec![config.url.clone()];
    args.push("--name".to_string());
    args.push(app_name.clone());
    args.push("--width".to_string());
    args.push(config.width.to_string());
    args.push("--height".to_string());
    args.push(config.height.to_string());

    if !config.resizable {
        args.push("--no-resizable".to_string());
    }
    if config.fullscreen {
        args.push("--fullscreen".to_string());
    }
    if config.hide_title_bar {
        args.push("--hide-title-bar".to_string());
    }
    if config.always_on_top {
        args.push("--always-on-top".to_string());
    }
    if config.dark_mode {
        args.push("--dark-mode".to_string());
    }
    if config.show_system_tray {
        args.push("--show-system-tray".to_string());
    }

    // Handle CSS/JS injection by writing to temp files
    let temp_dir = std::env::temp_dir().join("pake-gui-inject");
    std::fs::create_dir_all(&temp_dir).map_err(|e| e.to_string())?;
    let mut inject_files = Vec::new();

    if !config.inject_css.is_empty() {
        let css_path = temp_dir.join("custom.css");
        std::fs::write(&css_path, &config.inject_css).map_err(|e| e.to_string())?;
        inject_files.push(css_path.to_string_lossy().to_string());
    }
    if !config.inject_js.is_empty() {
        let js_path = temp_dir.join("custom.js");
        std::fs::write(&js_path, &config.inject_js).map_err(|e| e.to_string())?;
        inject_files.push(js_path.to_string_lossy().to_string());
    }
    if !inject_files.is_empty() {
        args.push("--inject".to_string());
        args.push(inject_files.join(","));
    }

    // Emit initial progress
    let _ = window.emit("build-progress", BuildProgress {
        status: "building".to_string(),
        message: format!("Starting build for {}...", app_name),
        app_name: app_name.clone(),
        progress_pct: 10,
    });

    // Run pake CLI as subprocess
    let mut child = Command::new("npx")
        .arg("pake")
        .args(&args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start pake: {}", e))?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    let output_lines = Arc::new(Mutex::new(Vec::<String>::new()));

    // Stream stdout
    if let Some(stdout) = stdout {
        let lines = output_lines.clone();
        let win = window.clone();
        let name = app_name.clone();
        tokio::spawn(async move {
            let reader = BufReader::new(stdout);
            let mut line_reader = reader.lines();
            while let Ok(Some(line)) = line_reader.next_line().await {
                lines.lock().await.push(line.clone());
                let _ = win.emit("build-progress", BuildProgress {
                    status: "building".to_string(),
                    message: line,
                    app_name: name.clone(),
                    progress_pct: 50,
                });
            }
        });
    }

    // Stream stderr
    if let Some(stderr) = stderr {
        let lines = output_lines.clone();
        let win = window.clone();
        let name = app_name.clone();
        tokio::spawn(async move {
            let reader = BufReader::new(stderr);
            let mut line_reader = reader.lines();
            while let Ok(Some(line)) = line_reader.next_line().await {
                lines.lock().await.push(line.clone());
                let _ = win.emit("build-progress", BuildProgress {
                    status: "building".to_string(),
                    message: line,
                    app_name: name.clone(),
                    progress_pct: 50,
                });
            }
        });
    }

    let status = child.wait().await.map_err(|e| e.to_string())?;

    if status.success() {
        let _ = window.emit("build-progress", BuildProgress {
            status: "complete".to_string(),
            message: format!("{} built successfully!", app_name),
            app_name: app_name.clone(),
            progress_pct: 100,
        });
        Ok(format!("{} built successfully!", app_name))
    } else {
        let logs = output_lines.lock().await.join("\n");
        let _ = window.emit("build-progress", BuildProgress {
            status: "error".to_string(),
            message: format!("Build failed for {}", app_name),
            app_name: app_name.clone(),
            progress_pct: 0,
        });
        Err(format!("Build failed:\n{}", logs))
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            build_app,
            list_profiles,
            save_profile,
            delete_profile,
        ])
        .run(tauri::generate_context!())
        .expect("error while running pake gui");
}
