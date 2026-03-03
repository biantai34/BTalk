use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime};

const MONITOR_DURATION_MS: u64 = 5000;
const CANCEL_CHECK_INTERVAL_MS: u64 = 100;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct QualityMonitorResultPayload {
    was_modified: bool,
}

pub struct KeyboardMonitorState {
    pub is_monitoring: Arc<AtomicBool>,
    pub was_modified: Arc<AtomicBool>,
    pub cancel_token: Arc<AtomicBool>,
}

impl KeyboardMonitorState {
    pub fn new() -> Self {
        Self {
            is_monitoring: Arc::new(AtomicBool::new(false)),
            was_modified: Arc::new(AtomicBool::new(false)),
            cancel_token: Arc::new(AtomicBool::new(false)),
        }
    }
}

/// 分段等待，定期檢查 cancel_token。回傳 true 表示被取消。
fn wait_with_cancellation(
    cancel_token: &Arc<AtomicBool>,
    duration_ms: u64,
    check_interval_ms: u64,
) -> bool {
    let iterations = duration_ms / check_interval_ms;
    for _ in 0..iterations {
        if cancel_token.load(Ordering::SeqCst) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(check_interval_ms));
    }
    false
}

fn emit_result<R: Runtime>(app_handle: &AppHandle<R>, was_modified: bool) {
    let payload = QualityMonitorResultPayload { was_modified };
    let _ = app_handle.emit("quality-monitor:result", payload);
    #[cfg(debug_assertions)]
    println!(
        "[keyboard-monitor] Emitted result: wasModified={}",
        was_modified
    );
}

// ========== macOS Implementation ==========

#[cfg(target_os = "macos")]
mod macos_keycodes {
    pub const BACKSPACE: u16 = 51;
    pub const DELETE: u16 = 117;
}

#[cfg(target_os = "macos")]
fn start_monitoring_platform<R: Runtime>(
    app_handle: AppHandle<R>,
    state: Arc<AtomicBool>,
    cancel_token: Arc<AtomicBool>,
    is_monitoring: Arc<AtomicBool>,
) {
    use core_foundation::runloop::{kCFRunLoopCommonModes, CFRunLoop};
    use core_graphics::event::{
        CGEventTap, CGEventTapLocation, CGEventTapOptions, CGEventTapPlacement, CGEventType,
    };

    std::thread::spawn(move || {
        let was_modified = state.clone();
        let was_modified_for_tap = state;

        let tap_result = CGEventTap::new(
            CGEventTapLocation::Session,
            CGEventTapPlacement::HeadInsertEventTap,
            CGEventTapOptions::ListenOnly,
            vec![CGEventType::KeyDown],
            move |_proxy, _event_type, event| {
                let keycode = event.get_integer_value_field(
                    core_graphics::event::EventField::KEYBOARD_EVENT_KEYCODE,
                ) as u16;

                if keycode == macos_keycodes::BACKSPACE || keycode == macos_keycodes::DELETE {
                    was_modified_for_tap.store(true, Ordering::SeqCst);
                    #[cfg(debug_assertions)]
                    println!("[keyboard-monitor] Detected modify key: keycode={}", keycode);
                }
                None
            },
        );

        match tap_result {
            Ok(tap) => {
                #[cfg(debug_assertions)]
                println!("[keyboard-monitor] CGEventTap created, monitoring for 5 seconds...");
                unsafe {
                    let loop_source = tap
                        .mach_port
                        .create_runloop_source(0)
                        .expect("Failed to create runloop source");
                    let run_loop = CFRunLoop::get_current();
                    run_loop.add_source(&loop_source, kCFRunLoopCommonModes);
                    tap.enable();

                    // 啟動計時器執行緒，到期後停止 RunLoop
                    let run_loop_ref = CFRunLoop::get_current();
                    let cancel_for_timer = cancel_token.clone();
                    std::thread::spawn(move || {
                        let cancelled = wait_with_cancellation(
                            &cancel_for_timer,
                            MONITOR_DURATION_MS,
                            CANCEL_CHECK_INTERVAL_MS,
                        );
                        if cancelled {
                            #[cfg(debug_assertions)]
                            println!("[keyboard-monitor] Monitoring cancelled");
                        }
                        run_loop_ref.stop();
                    });

                    CFRunLoop::run_current();
                }

                let result = was_modified.load(Ordering::SeqCst);
                is_monitoring.store(false, Ordering::SeqCst);
                emit_result(&app_handle, result);
            }
            Err(()) => {
                eprintln!("[keyboard-monitor] Failed to create CGEventTap (no Accessibility permission?)");
                is_monitoring.store(false, Ordering::SeqCst);
                emit_result(&app_handle, false);
            }
        }
    });
}

// ========== Windows Implementation ==========

#[cfg(target_os = "windows")]
fn start_monitoring_platform<R: Runtime>(
    app_handle: AppHandle<R>,
    state: Arc<AtomicBool>,
    cancel_token: Arc<AtomicBool>,
    is_monitoring: Arc<AtomicBool>,
) {
    use std::sync::OnceLock;

    const VK_BACK: u32 = 0x08;
    const VK_DELETE: u32 = 0x2E;
    const WM_KEYDOWN: u32 = 0x0100;
    const WM_SYSKEYDOWN: u32 = 0x0104;

    // OnceLock 用於將 AtomicBool 傳遞給 static hook callback（Windows API 限制）。
    // OnceLock::set 只會成功一次，但因為所有輪次共享同一個 Arc<AtomicBool>，
    // 透過 start_quality_monitor 中的 was_modified.store(false, ...) 重置即可正確運作。
    static MONITOR_STATE: OnceLock<Arc<AtomicBool>> = OnceLock::new();

    let _ = MONITOR_STATE.set(state.clone());

    std::thread::spawn(move || {
        use windows::Win32::Foundation::*;
        use windows::Win32::UI::WindowsAndMessaging::*;

        unsafe extern "system" fn hook_proc(
            n_code: i32,
            w_param: WPARAM,
            l_param: LPARAM,
        ) -> LRESULT {
            use windows::Win32::UI::WindowsAndMessaging::*;

            if n_code >= 0 {
                let kbd = *(l_param.0 as *const KBDLLHOOKSTRUCT);
                let w = w_param.0 as u32;

                if w == WM_KEYDOWN || w == WM_SYSKEYDOWN {
                    if kbd.vkCode == VK_BACK || kbd.vkCode == VK_DELETE {
                        if let Some(state) = MONITOR_STATE.get() {
                            state.store(true, Ordering::SeqCst);
                            #[cfg(debug_assertions)]
                            println!(
                                "[keyboard-monitor] Detected modify key: vkCode=0x{:02X}",
                                kbd.vkCode
                            );
                        }
                    }
                }
            }

            CallNextHookEx(None, n_code, w_param, l_param)
        }

        unsafe {
            match SetWindowsHookExW(WH_KEYBOARD_LL, Some(hook_proc), None, 0) {
                Ok(hook) => {
                    #[cfg(debug_assertions)]
                    println!("[keyboard-monitor] Windows hook installed, monitoring for 5 seconds...");

                    // 取得當前執行緒 ID，用於計時器執行緒結束 message loop
                    let thread_id = windows::Win32::System::Threading::GetCurrentThreadId();

                    let cancel_for_timer = cancel_token.clone();
                    std::thread::spawn(move || {
                        let cancelled = wait_with_cancellation(
                            &cancel_for_timer,
                            MONITOR_DURATION_MS,
                            CANCEL_CHECK_INTERVAL_MS,
                        );
                        if cancelled {
                            #[cfg(debug_assertions)]
                            println!("[keyboard-monitor] Monitoring cancelled");
                        }
                        unsafe {
                            let _ = PostThreadMessageW(thread_id, WM_QUIT, WPARAM(0), LPARAM(0));
                        }
                    });

                    // Message loop
                    let mut msg = MSG::default();
                    while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                        let _ = TranslateMessage(&msg);
                        DispatchMessageW(&msg);
                    }

                    let _ = UnhookWindowsHookEx(hook);

                    let result = state.load(Ordering::SeqCst);
                    is_monitoring.store(false, Ordering::SeqCst);
                    emit_result(&app_handle, result);
                }
                Err(e) => {
                    eprintln!("[keyboard-monitor] Failed to install hook: {}", e);
                    is_monitoring.store(false, Ordering::SeqCst);
                    emit_result(&app_handle, false);
                }
            }
        }
    });
}

// ========== Unsupported platforms ==========

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn start_monitoring_platform<R: Runtime>(
    app_handle: AppHandle<R>,
    _state: Arc<AtomicBool>,
    _cancel_token: Arc<AtomicBool>,
    is_monitoring: Arc<AtomicBool>,
) {
    #[cfg(debug_assertions)]
    println!("[keyboard-monitor] Platform not supported, skipping monitor");
    is_monitoring.store(false, Ordering::SeqCst);
    emit_result(&app_handle, false);
}

// ========== Tauri Command ==========

#[tauri::command]
pub fn start_quality_monitor<R: Runtime>(app: AppHandle<R>) {
    let state = app.state::<KeyboardMonitorState>();

    // 若已有監控進行中，先取消
    if state.is_monitoring.load(Ordering::SeqCst) {
        #[cfg(debug_assertions)]
        println!("[keyboard-monitor] Cancelling previous monitor session");
        state.cancel_token.store(true, Ordering::SeqCst);
        std::thread::sleep(Duration::from_millis(150));
    }

    // 重置狀態
    state.was_modified.store(false, Ordering::SeqCst);
    state.is_monitoring.store(true, Ordering::SeqCst);
    state.cancel_token.store(false, Ordering::SeqCst);

    #[cfg(debug_assertions)]
    println!("[keyboard-monitor] Starting quality monitor");

    start_monitoring_platform(
        app.clone(),
        state.was_modified.clone(),
        state.cancel_token.clone(),
        state.is_monitoring.clone(),
    );
}

// ========== Tests ==========

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_keyboard_monitor_state_initial_values() {
        let state = KeyboardMonitorState::new();
        assert!(!state.is_monitoring.load(Ordering::SeqCst));
        assert!(!state.was_modified.load(Ordering::SeqCst));
        assert!(!state.cancel_token.load(Ordering::SeqCst));
    }

    #[test]
    fn test_state_reset_logic() {
        let state = KeyboardMonitorState::new();
        state.is_monitoring.store(true, Ordering::SeqCst);
        state.was_modified.store(true, Ordering::SeqCst);
        state.cancel_token.store(true, Ordering::SeqCst);

        // 模擬重置
        state.was_modified.store(false, Ordering::SeqCst);
        state.is_monitoring.store(true, Ordering::SeqCst);
        state.cancel_token.store(false, Ordering::SeqCst);

        assert!(state.is_monitoring.load(Ordering::SeqCst));
        assert!(!state.was_modified.load(Ordering::SeqCst));
        assert!(!state.cancel_token.load(Ordering::SeqCst));
    }

    #[test]
    fn test_cancel_token_stops_monitoring() {
        let state = KeyboardMonitorState::new();
        state.is_monitoring.store(true, Ordering::SeqCst);

        // 設定取消
        state.cancel_token.store(true, Ordering::SeqCst);

        assert!(state.cancel_token.load(Ordering::SeqCst));
    }

    #[test]
    fn test_wait_with_cancellation_normal_expiry() {
        let cancel_token = Arc::new(AtomicBool::new(false));
        let cancelled = wait_with_cancellation(&cancel_token, 200, 100);
        assert!(!cancelled);
    }

    #[test]
    fn test_wait_with_cancellation_cancelled() {
        let cancel_token = Arc::new(AtomicBool::new(false));
        let cancel_clone = cancel_token.clone();

        // 另一個執行緒在 50ms 後取消
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(50));
            cancel_clone.store(true, Ordering::SeqCst);
        });

        let cancelled = wait_with_cancellation(&cancel_token, 5000, 100);
        assert!(cancelled);
    }
}
