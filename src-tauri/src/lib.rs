#[cfg(target_os = "macos")]
#[macro_use]
extern crate objc;

mod plugins;

use tauri::{
    AppHandle,
    command,
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Manager,
};

/// 設定 macOS 視窗為瀏海覆蓋層級（與 BoringNotch 相同）
#[cfg(target_os = "macos")]
#[allow(unexpected_cfgs)]
fn configure_macos_notch_window(window: &tauri::WebviewWindow) {
    match window.ns_window() {
        Ok(ns_ptr) => {
            let ns_win = ns_ptr as *mut objc::runtime::Object;
            unsafe {
                // 視窗層級: NSMainMenuWindowLevel(24) + 3 = 27
                let _: () = objc::msg_send![ns_win, setLevel: 27_i64];

                // collectionBehavior: 出現在所有桌面、桌面切換時不移動
                // canJoinAllSpaces(1) | stationary(16) | ignoresCycle(64) | fullScreenAuxiliary(256)
                let behavior: u64 = 1 | 16 | 64 | 256;
                let _: () = objc::msg_send![ns_win, setCollectionBehavior: behavior];

                // 防止視窗被拖動
                let _: () = objc::msg_send![ns_win, setMovable: false];
            }
            println!("[macos] Notch window configured: level=27");
        }
        Err(e) => {
            eprintln!("[macos] Failed to get NSWindow: {}", e);
        }
    }
}

/// 設定 Windows 視窗為工作列覆蓋層級（對應 macOS 的 setLevel:27）
#[cfg(target_os = "windows")]
fn configure_windows_topmost_window(window: &tauri::WebviewWindow) {
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos,
        GWL_EXSTYLE, HWND_TOPMOST,
        SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
        WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WINDOW_EX_STYLE,
    };

    match window.hwnd() {
        Ok(hwnd) => unsafe {
            // 讀取現有 extended style，加入 TOOLWINDOW + NOACTIVATE
            let ex_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            let new_ex_style = WINDOW_EX_STYLE(ex_style as u32)
                | WS_EX_TOOLWINDOW    // 不出現在 Alt+Tab / taskbar，出現在所有虛擬桌面
                | WS_EX_NOACTIVATE;   // 點擊不搶焦點
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, new_ex_style.0 as isize);

            // HWND_TOPMOST: 視窗永遠在最上層（包括 taskbar 之上）
            let _ = SetWindowPos(
                hwnd,
                Some(HWND_TOPMOST),
                0, 0, 0, 0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_FRAMECHANGED,
            );

            println!("[windows] Topmost window configured: HWND_TOPMOST + WS_EX_TOOLWINDOW");
        },
        Err(e) => {
            eprintln!("[windows] Failed to get HWND: {}", e);
        }
    }
}

#[command]
fn debug_log(level: String, message: String) {
    match level.as_str() {
        "error" => eprintln!("[webview:ERROR] {}", message),
        "warn" => println!("[webview:WARN] {}", message),
        _ => println!("[webview] {}", message),
    }
}

#[command]
fn update_hotkey_config(
    app: tauri::AppHandle,
    trigger_key: plugins::hotkey_listener::TriggerKey,
    trigger_mode: plugins::hotkey_listener::TriggerMode,
) -> Result<(), String> {
    let state = app.state::<plugins::hotkey_listener::HotkeyListenerState>();
    println!(
        "[hotkey-listener] Config updated: key={:?}, mode={:?}",
        trigger_key, trigger_mode
    );
    state.update_config(trigger_key, trigger_mode);
    Ok(())
}

/// HUD 視窗邏輯寬度（pixels），對應前端 CSS 400px
const HUD_WINDOW_WIDTH_LOGICAL: f64 = 400.0;

/// macOS: 取得滑鼠游標座標（logical points，原點在主螢幕左上角）
#[cfg(target_os = "macos")]
fn get_cursor_position() -> (f64, f64) {
    #[repr(C)]
    #[derive(Copy, Clone)]
    struct CGPoint {
        x: f64,
        y: f64,
    }

    // 不透明 C 型別
    enum CGEventRef {}
    type CFTypeRef = *const std::ffi::c_void;

    extern "C" {
        fn CGEventCreate(source: CFTypeRef) -> *const CGEventRef;
        fn CGEventGetLocation(event: *const CGEventRef) -> CGPoint;
        fn CFRelease(cf: CFTypeRef);
    }

    /// Scope guard 確保 CGEvent 物件一定被 CFRelease，即使 panic 也不洩漏
    struct CgEventGuard(*const CGEventRef);
    impl Drop for CgEventGuard {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe { CFRelease(self.0 as CFTypeRef); }
            }
        }
    }

    unsafe {
        let event = CGEventCreate(std::ptr::null());
        if event.is_null() {
            eprintln!("[hud-tracking] CGEventCreate returned null");
            return (0.0, 0.0);
        }
        let _guard = CgEventGuard(event);
        let point = CGEventGetLocation(event);
        (point.x, point.y)
    }
}

/// Windows: 取得滑鼠游標座標（virtual screen 座標）
#[cfg(target_os = "windows")]
fn get_cursor_position() -> (f64, f64) {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;

    let mut point = POINT::default();
    unsafe {
        if let Err(e) = GetCursorPos(&mut point) {
            eprintln!("[hud-tracking] GetCursorPos failed: {}", e);
        }
    }
    (point.x as f64, point.y as f64)
}

/// `get_hud_target_position` 回傳給前端的定位資訊
#[derive(serde::Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct HudTargetPosition {
    x: i32,
    y: i32,
    monitor_key: String,
}

/// 抽象化的螢幕資訊，用於 `find_monitor_for_cursor()` 純函式測試
#[derive(Clone, Debug)]
pub struct MonitorInfo {
    /// 螢幕左上角 physical position x
    pub position_x: i32,
    /// 螢幕左上角 physical position y
    pub position_y: i32,
    /// 螢幕 physical width
    pub width: u32,
    /// 螢幕 physical height
    pub height: u32,
    /// DPI scale factor
    pub scale_factor: f64,
}

/// 根據游標座標找到所在螢幕的 index
///
/// macOS: 游標座標是 logical pixels (points)，需將 monitor physical position
///        除以各自的 scale_factor 轉為 logical 後比對
/// Windows: 游標座標與 monitor physical position 在同一座標系統，直接比對
///
/// 若無螢幕匹配，fallback 到 index 0；空陣列回傳 None
pub fn find_monitor_for_cursor(
    cursor_x: f64,
    cursor_y: f64,
    monitors: &[MonitorInfo],
    is_macos: bool,
) -> Option<usize> {
    if monitors.is_empty() {
        return None;
    }

    for (i, monitor) in monitors.iter().enumerate() {
        let (left, top, right, bottom) = if is_macos {
            // macOS: convert physical to logical
            let sf = monitor.scale_factor;
            let l = monitor.position_x as f64 / sf;
            let t = monitor.position_y as f64 / sf;
            let r = l + monitor.width as f64 / sf;
            let b = t + monitor.height as f64 / sf;
            (l, t, r, b)
        } else {
            // Windows: use physical directly
            let l = monitor.position_x as f64;
            let t = monitor.position_y as f64;
            let r = l + monitor.width as f64;
            let b = t + monitor.height as f64;
            (l, t, r, b)
        };

        if cursor_x >= left && cursor_x < right && cursor_y >= top && cursor_y < bottom {
            return Some(i);
        }
    }
    // fallback to first monitor
    Some(0)
}

/// 計算視窗水平置中位置（像素座標）
/// 回傳 x 座標（已乘以 scale_factor），用於 PhysicalPosition
pub fn calculate_centered_window_x(
    screen_width_physical: u32,
    scale_factor: f64,
    window_width_logical: f64,
) -> i32 {
    let screen_width_logical = screen_width_physical as f64 / scale_factor;
    let x_logical = (screen_width_logical - window_width_logical) / 2.0;
    (x_logical * scale_factor) as i32
}

/// 取得 HUD 應定位到的目標螢幕座標
///
/// 流程：
/// 1. 取得游標座標
/// 2. 列舉所有螢幕
/// 3. 找到游標所在螢幕
/// 4. 計算該螢幕頂部水平置中位置
/// 5. 回傳 PhysicalPosition + monitor key
#[command]
fn get_hud_target_position(app: tauri::AppHandle) -> Result<HudTargetPosition, String> {
    let (cursor_x, cursor_y) = get_cursor_position();

    let monitors = app.available_monitors().map_err(|e| e.to_string())?;

    if monitors.is_empty() {
        return Err("No monitors found".to_string());
    }

    let monitor_infos: Vec<MonitorInfo> = monitors
        .iter()
        .map(|m| MonitorInfo {
            position_x: m.position().x,
            position_y: m.position().y,
            width: m.size().width,
            height: m.size().height,
            scale_factor: m.scale_factor(),
        })
        .collect();

    let is_macos = cfg!(target_os = "macos");
    // safe to unwrap: monitors is non-empty, so find_monitor_for_cursor always returns Some
    let idx = find_monitor_for_cursor(cursor_x, cursor_y, &monitor_infos, is_macos)
        .expect("monitors is non-empty");

    let monitor = &monitors[idx];
    let centered_x = calculate_centered_window_x(
        monitor.size().width,
        monitor.scale_factor(),
        HUD_WINDOW_WIDTH_LOGICAL,
    );

    let hud_x = monitor.position().x + centered_x;
    let hud_y = monitor.position().y;
    let monitor_key = format!("{},{}", monitor.position().x, monitor.position().y);

    Ok(HudTargetPosition {
        x: hud_x,
        y: hud_y,
        monitor_key,
    })
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main-window") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(plugins::hotkey_listener::init())
        .invoke_handler(tauri::generate_handler![
            debug_log,
            update_hotkey_config,
            get_hud_target_position,
            plugins::clipboard_paste::paste_text,
            plugins::hotkey_listener::check_accessibility_permission_command,
            plugins::hotkey_listener::open_accessibility_settings,
            plugins::keyboard_monitor::start_quality_monitor
        ])
        .setup(|app| {
            // 初始化 keyboard monitor 狀態
            app.manage(plugins::keyboard_monitor::KeyboardMonitorState::new());

            let open_dashboard_item =
                MenuItem::with_id(app, "open-dashboard", "開啟 Dashboard", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit SayIt", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_dashboard_item, &quit_item])?;

            TrayIconBuilder::new()
                .icon(tauri::image::Image::from_bytes(include_bytes!("../icons/icon.png"))?)
                .menu(&menu)
                .show_menu_on_left_click(true)
                .tooltip("SayIt")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open-dashboard" => {
                        show_main_window(app);
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;

            if let Some(window) = app.get_webview_window("main") {
                #[cfg(target_os = "macos")]
                configure_macos_notch_window(&window);

                #[cfg(target_os = "windows")]
                configure_windows_topmost_window(&window);

                if let Ok(monitor) = window.current_monitor() {
                    if let Some(monitor) = monitor {
                        let x = calculate_centered_window_x(
                            monitor.size().width,
                            monitor.scale_factor(),
                            HUD_WINDOW_WIDTH_LOGICAL,
                        );
                        let _ = window.set_position(tauri::PhysicalPosition::new(x, 0));
                    }
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main-window" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                    println!("[main-window] Close requested → hidden (not destroyed)");
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Reopen { .. } = event {
                show_main_window(app_handle);
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    // ============================================================
    // calculate_centered_window_x 測試
    // ============================================================

    #[test]
    fn test_centered_window_x_standard_1080p() {
        // 1920px 螢幕、scale_factor=1.0、視窗寬 400px
        // 期望 x = (1920 - 400) / 2 = 760
        let x = calculate_centered_window_x(1920, 1.0, 400.0);
        assert_eq!(x, 760);
    }

    #[test]
    fn test_centered_window_x_retina_display() {
        // Retina: physical=2560, scale=2.0 → logical=1280
        // x_logical = (1280 - 400) / 2 = 440
        // x_physical = 440 * 2.0 = 880
        let x = calculate_centered_window_x(2560, 2.0, 400.0);
        assert_eq!(x, 880);
    }

    #[test]
    fn test_centered_window_x_fractional_scale() {
        // 150% 縮放: physical=2880, scale=1.5 → logical=1920
        // x_logical = (1920 - 400) / 2 = 760
        // x_physical = 760 * 1.5 = 1140
        let x = calculate_centered_window_x(2880, 1.5, 400.0);
        assert_eq!(x, 1140);
    }

    #[test]
    fn test_centered_window_x_window_equals_screen() {
        // 視窗與螢幕同寬時，x 應為 0
        let x = calculate_centered_window_x(400, 1.0, 400.0);
        assert_eq!(x, 0);
    }

    #[test]
    fn test_centered_window_x_4k_display() {
        // 4K: physical=3840, scale=2.0 → logical=1920
        // x_logical = (1920 - 400) / 2 = 760
        // x_physical = 760 * 2.0 = 1520
        let x = calculate_centered_window_x(3840, 2.0, 400.0);
        assert_eq!(x, 1520);
    }

    // ============================================================
    // find_monitor_for_cursor 測試
    // ============================================================

    fn make_monitor(px: i32, py: i32, w: u32, h: u32, sf: f64) -> MonitorInfo {
        MonitorInfo {
            position_x: px,
            position_y: py,
            width: w,
            height: h,
            scale_factor: sf,
        }
    }

    #[test]
    fn test_find_monitor_single_monitor() {
        let monitors = vec![make_monitor(0, 0, 1920, 1080, 1.0)];
        // 游標在螢幕中央
        assert_eq!(find_monitor_for_cursor(960.0, 540.0, &monitors, false), Some(0));
        // macOS 也一樣（scale 1.0）
        assert_eq!(find_monitor_for_cursor(960.0, 540.0, &monitors, true), Some(0));
    }

    #[test]
    fn test_find_monitor_dual_horizontal() {
        // 雙螢幕水平排列: [0,0 1920x1080] [1920,0 1920x1080]
        let monitors = vec![
            make_monitor(0, 0, 1920, 1080, 1.0),
            make_monitor(1920, 0, 1920, 1080, 1.0),
        ];
        // 游標在右螢幕
        assert_eq!(find_monitor_for_cursor(2000.0, 500.0, &monitors, false), Some(1));
        // 游標在左螢幕
        assert_eq!(find_monitor_for_cursor(100.0, 500.0, &monitors, false), Some(0));
    }

    #[test]
    fn test_find_monitor_dual_vertical() {
        // 副螢幕在上方（y 為負值）
        let monitors = vec![
            make_monitor(0, 0, 1920, 1080, 1.0),       // 主螢幕
            make_monitor(0, -1080, 1920, 1080, 1.0),    // 上方副螢幕
        ];
        // 游標在上方螢幕
        assert_eq!(find_monitor_for_cursor(960.0, -500.0, &monitors, false), Some(1));
        // 游標在主螢幕
        assert_eq!(find_monitor_for_cursor(960.0, 500.0, &monitors, false), Some(0));
    }

    #[test]
    fn test_find_monitor_dual_different_dpi_macos() {
        // macOS: Retina 2x (physical 2560x1600) + 外接 1080p 1x (physical 1920x1080)
        // Tauri monitor position 為 physical pixels，游標座標為 logical points。
        // Retina: physical (0,0) → logical (0,0), logical size 1280x800
        // 外接: physical (2560,0) → logical (2560,0), logical size 1920x1080
        // logical 座標存在間隙 (1280~2560)，因兩螢幕 scale factor 不同
        let monitors = vec![
            make_monitor(0, 0, 2560, 1600, 2.0),        // Retina 主螢幕
            make_monitor(2560, 0, 1920, 1080, 1.0),      // 外接 1080p
        ];
        // 游標在 Retina 主螢幕（logical x=640, y=400）
        assert_eq!(find_monitor_for_cursor(640.0, 400.0, &monitors, true), Some(0));
        // 游標在外接螢幕（logical x=3000, y=500）
        assert_eq!(find_monitor_for_cursor(3000.0, 500.0, &monitors, true), Some(1));
    }

    #[test]
    fn test_find_monitor_cursor_at_boundary() {
        let monitors = vec![
            make_monitor(0, 0, 1920, 1080, 1.0),
            make_monitor(1920, 0, 1920, 1080, 1.0),
        ];
        // 游標恰好在右螢幕左邊界上（x=1920）
        assert_eq!(find_monitor_for_cursor(1920.0, 500.0, &monitors, false), Some(1));
        // 游標恰好在左螢幕左上角（x=0, y=0）
        assert_eq!(find_monitor_for_cursor(0.0, 0.0, &monitors, false), Some(0));
    }

    #[test]
    fn test_find_monitor_cursor_negative_coords() {
        // 副螢幕在主螢幕左方（x 為負）
        let monitors = vec![
            make_monitor(0, 0, 1920, 1080, 1.0),
            make_monitor(-1920, 0, 1920, 1080, 1.0),
        ];
        // 游標在左方副螢幕
        assert_eq!(find_monitor_for_cursor(-500.0, 500.0, &monitors, false), Some(1));
    }

    #[test]
    fn test_find_monitor_fallback() {
        // 游標座標不在任何螢幕內 → fallback 到 index 0
        let monitors = vec![
            make_monitor(0, 0, 1920, 1080, 1.0),
        ];
        assert_eq!(find_monitor_for_cursor(5000.0, 5000.0, &monitors, false), Some(0));
    }

    #[test]
    fn test_find_monitor_empty_monitors() {
        // 空螢幕列表 → None
        let monitors: Vec<MonitorInfo> = vec![];
        assert_eq!(find_monitor_for_cursor(960.0, 540.0, &monitors, false), None);
    }
}
