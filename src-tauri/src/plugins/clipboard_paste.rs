use arboard::Clipboard;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Runtime};

#[derive(Debug, thiserror::Error)]
pub enum ClipboardError {
    #[error("Clipboard access failed: {0}")]
    ClipboardAccess(String),
    #[error("Keyboard simulation failed: {0}")]
    #[allow(dead_code)]
    KeyboardSimulation(String),
}

impl serde::Serialize for ClipboardError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

/// 透過 Accessibility API 按下目標 app 的「貼上」選單項目來觸發貼上。
///
/// 流程：取得前景 app → 找到其 menu bar → 搜尋 Cmd+V 對應的 menu item → AXPress
/// 目標 app 自己執行貼上，不涉及任何鍵盤事件模擬，不會有 CGEvent 殘留。
/// 只需要 Accessibility 權限。
#[cfg(target_os = "macos")]
fn trigger_paste_via_menu() -> Result<(), String> {
    use core_foundation::base::{CFRelease, CFTypeRef, TCFType};
    use core_foundation::string::CFString;

    type AXUIElementRef = CFTypeRef;
    type AXError = i32;
    const AX_ERROR_SUCCESS: AXError = 0;

    extern "C" {
        fn AXUIElementCreateApplication(pid: i32) -> AXUIElementRef;
        fn AXUIElementCopyAttributeValue(
            element: AXUIElementRef,
            attribute: core_foundation::string::CFStringRef,
            value: *mut CFTypeRef,
        ) -> AXError;
    }

    unsafe {
        // 1) 取得前景 app 的 PID
        let workspace: *mut objc::runtime::Object =
            objc::msg_send![objc::class!(NSWorkspace), sharedWorkspace];
        let front_app: *mut objc::runtime::Object =
            objc::msg_send![workspace, frontmostApplication];
        if front_app.is_null() {
            return Err("No frontmost application".to_string());
        }
        let pid: i32 = objc::msg_send![front_app, processIdentifier];
        println!("[clipboard-paste] Frontmost app PID: {}", pid);

        // 2) 建立該 app 的 AX element 並取得 menu bar
        let app_element = AXUIElementCreateApplication(pid);
        if app_element.is_null() {
            return Err("Failed to create AX element for app".to_string());
        }

        let attr_menu_bar = CFString::new("AXMenuBar");
        let mut menu_bar: CFTypeRef = std::ptr::null();
        let err = AXUIElementCopyAttributeValue(
            app_element,
            attr_menu_bar.as_concrete_TypeRef(),
            &mut menu_bar,
        );
        CFRelease(app_element);
        if err != AX_ERROR_SUCCESS || menu_bar.is_null() {
            return Err(format!("Failed to get menu bar (AXError: {})", err));
        }

        // 3) 遍歷 menu bar → 各 menu → 找 Cmd+V 的 menu item
        let result = find_and_press_paste_menu_item(menu_bar);
        CFRelease(menu_bar);
        result
    }
}

/// 在 menu bar 中搜尋 Cmd+V 對應的 menu item 並按下它
#[cfg(target_os = "macos")]
unsafe fn find_and_press_paste_menu_item(
    menu_bar: core_foundation::base::CFTypeRef,
) -> Result<(), String> {
    use core_foundation::array::CFArray;
    use core_foundation::base::{CFRelease, CFTypeRef, TCFType};
    use core_foundation::string::CFString;

    type AXUIElementRef = CFTypeRef;
    type AXError = i32;
    const AX_ERROR_SUCCESS: AXError = 0;

    extern "C" {
        fn AXUIElementCopyAttributeValue(
            element: AXUIElementRef,
            attribute: core_foundation::string::CFStringRef,
            value: *mut CFTypeRef,
        ) -> AXError;
        fn AXUIElementPerformAction(
            element: AXUIElementRef,
            action: core_foundation::string::CFStringRef,
        ) -> AXError;
    }

    let attr_children = CFString::new("AXChildren");
    let attr_cmd_char = CFString::new("AXMenuItemCmdChar");
    let attr_cmd_modifiers = CFString::new("AXMenuItemCmdModifiers");
    let action_press = CFString::new("AXPress");

    // 取得 menu bar 的子項目（File, Edit, View 等 menu bar items）
    let mut bar_children_ref: CFTypeRef = std::ptr::null();
    let err = AXUIElementCopyAttributeValue(
        menu_bar,
        attr_children.as_concrete_TypeRef(),
        &mut bar_children_ref,
    );
    if err != AX_ERROR_SUCCESS || bar_children_ref.is_null() {
        return Err(format!("Failed to get menu bar children (AXError: {})", err));
    }

    let bar_items =
        CFArray::<CFTypeRef>::wrap_under_create_rule(bar_children_ref as core_foundation::array::CFArrayRef);

    // 結構：Menu Bar → Menu Bar Items → AXMenu → Menu Items
    for i in 0..bar_items.len() {
        let bar_item = bar_items.get(i).expect("bar_item index");

        // 取得 menu bar item 的子項目（應為一個 AXMenu）
        let mut menus_ref: CFTypeRef = std::ptr::null();
        let err = AXUIElementCopyAttributeValue(
            *bar_item as CFTypeRef,
            attr_children.as_concrete_TypeRef(),
            &mut menus_ref,
        );
        if err != AX_ERROR_SUCCESS || menus_ref.is_null() {
            continue;
        }
        let menus =
            CFArray::<CFTypeRef>::wrap_under_create_rule(menus_ref as core_foundation::array::CFArrayRef);

        // 遍歷每個 AXMenu
        for j in 0..menus.len() {
            let menu = menus.get(j).expect("menu index");

            // 取得 AXMenu 的子項目（實際的 menu items）
            let mut items_ref: CFTypeRef = std::ptr::null();
            let err = AXUIElementCopyAttributeValue(
                *menu as CFTypeRef,
                attr_children.as_concrete_TypeRef(),
                &mut items_ref,
            );
            if err != AX_ERROR_SUCCESS || items_ref.is_null() {
                continue;
            }
            let items =
                CFArray::<CFTypeRef>::wrap_under_create_rule(items_ref as core_foundation::array::CFArrayRef);

            for k in 0..items.len() {
                let menu_item = items.get(k).expect("menu_item index");

                // 檢查 AXMenuItemCmdChar 是否為 "v"
                let mut cmd_char_ref: CFTypeRef = std::ptr::null();
                let err = AXUIElementCopyAttributeValue(
                    *menu_item as CFTypeRef,
                    attr_cmd_char.as_concrete_TypeRef(),
                    &mut cmd_char_ref,
                );
                if err != AX_ERROR_SUCCESS || cmd_char_ref.is_null() {
                    continue;
                }
                let cmd_char = CFString::wrap_under_create_rule(
                    cmd_char_ref as core_foundation::string::CFStringRef,
                );
                if cmd_char.to_string().to_lowercase() != "v" {
                    continue;
                }

                // 檢查 AXMenuItemCmdModifiers 是否為 0（= 只有 Command）
                let mut cmd_mod_ref: CFTypeRef = std::ptr::null();
                let err = AXUIElementCopyAttributeValue(
                    *menu_item as CFTypeRef,
                    attr_cmd_modifiers.as_concrete_TypeRef(),
                    &mut cmd_mod_ref,
                );
                if err != AX_ERROR_SUCCESS || cmd_mod_ref.is_null() {
                    continue;
                }
                // AXMenuItemCmdModifiers: 0 代表只有 Command
                let mod_value = {
                    let mut val: i64 = -1;
                    core_foundation::number::CFNumberGetValue(
                        cmd_mod_ref as core_foundation::number::CFNumberRef,
                        core_foundation::number::kCFNumberSInt64Type,
                        &mut val as *mut i64 as *mut std::ffi::c_void,
                    );
                    CFRelease(cmd_mod_ref);
                    val
                };
                if mod_value != 0 {
                    continue;
                }

                // 找到 Cmd+V 的 menu item → 按下它
                println!("[clipboard-paste] Found Paste menu item, pressing via AXPress");
                let err = AXUIElementPerformAction(
                    *menu_item as CFTypeRef,
                    action_press.as_concrete_TypeRef(),
                );
                if err != AX_ERROR_SUCCESS {
                    return Err(format!("AXPress on Paste failed (AXError: {})", err));
                }
                return Ok(());
            }
        }
    }

    Err("Paste menu item (Cmd+V) not found in menu bar".to_string())
}

/// 透過 SendInput 模擬 Ctrl+V 按鍵來觸發貼上。
///
/// Windows 不像 macOS 有 CGEvent 殘留問題，SendInput 是標準做法。
#[cfg(target_os = "windows")]
fn simulate_paste_via_keyboard() -> Result<(), String> {
    use std::mem;
    use windows::Win32::UI::Input::KeyboardAndMouse::*;

    unsafe {
        let mut inputs: [INPUT; 4] = mem::zeroed();

        // Ctrl ↓
        inputs[0].r#type = INPUT_KEYBOARD;
        inputs[0].Anonymous.ki.wVk = VK_CONTROL;

        // V ↓
        inputs[1].r#type = INPUT_KEYBOARD;
        inputs[1].Anonymous.ki.wVk = VK_V;

        // V ↑
        inputs[2].r#type = INPUT_KEYBOARD;
        inputs[2].Anonymous.ki.wVk = VK_V;
        inputs[2].Anonymous.ki.dwFlags = KEYEVENTF_KEYUP;

        // Ctrl ↑
        inputs[3].r#type = INPUT_KEYBOARD;
        inputs[3].Anonymous.ki.wVk = VK_CONTROL;
        inputs[3].Anonymous.ki.dwFlags = KEYEVENTF_KEYUP;

        let sent = SendInput(&inputs, mem::size_of::<INPUT>() as i32);
        if sent != 4 {
            return Err(format!("SendInput returned {}, expected 4", sent));
        }
    }

    Ok(())
}

#[tauri::command]
pub fn copy_to_clipboard(text: String) -> Result<(), ClipboardError> {
    let mut clipboard =
        Clipboard::new().map_err(|e| ClipboardError::ClipboardAccess(e.to_string()))?;
    clipboard
        .set_text(&text)
        .map_err(|e| ClipboardError::ClipboardAccess(e.to_string()))?;
    Ok(())
}

#[tauri::command]
pub fn paste_text<R: Runtime>(_app: AppHandle<R>, text: String) -> Result<(), ClipboardError> {
    println!(
        "[clipboard-paste] Pasting {} chars: \"{}\"",
        text.len(),
        text
    );

    // 1) 寫入剪貼簿
    let mut clipboard =
        Clipboard::new().map_err(|e| ClipboardError::ClipboardAccess(e.to_string()))?;
    clipboard
        .set_text(&text)
        .map_err(|e| ClipboardError::ClipboardAccess(e.to_string()))?;
    println!("[clipboard-paste] Text copied to clipboard");

    // 2) 等待剪貼簿同步
    thread::sleep(Duration::from_millis(50));

    // 3) 觸發目標 app 的貼上動作
    #[cfg(target_os = "macos")]
    {
        match trigger_paste_via_menu() {
            Ok(()) => println!("[clipboard-paste] Paste triggered via menu AXPress"),
            Err(e) => {
                println!(
                    "[clipboard-paste] Menu paste failed: {}. Text is in clipboard for manual paste.",
                    e
                );
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        match simulate_paste_via_keyboard() {
            Ok(()) => println!("[clipboard-paste] Paste triggered via SendInput (Ctrl+V)"),
            Err(e) => {
                println!(
                    "[clipboard-paste] SendInput paste failed: {}. Text is in clipboard for manual paste.",
                    e
                );
            }
        }
    }

    println!("[clipboard-paste] Done");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    // ============================================================
    // ClipboardError Display 格式化測試
    // ============================================================

    #[test]
    fn test_clipboard_access_error_display() {
        let error = ClipboardError::ClipboardAccess("permission denied".to_string());
        assert_eq!(
            error.to_string(),
            "Clipboard access failed: permission denied"
        );
    }

    #[test]
    fn test_keyboard_simulation_error_display() {
        let error = ClipboardError::KeyboardSimulation("CGEvent failed".to_string());
        assert_eq!(
            error.to_string(),
            "Keyboard simulation failed: CGEvent failed"
        );
    }

    #[test]
    fn test_clipboard_access_error_display_empty_message() {
        let error = ClipboardError::ClipboardAccess(String::new());
        assert_eq!(error.to_string(), "Clipboard access failed: ");
    }

    #[test]
    fn test_keyboard_simulation_error_display_unicode() {
        let error = ClipboardError::KeyboardSimulation("鍵盤模擬失敗".to_string());
        assert_eq!(
            error.to_string(),
            "Keyboard simulation failed: 鍵盤模擬失敗"
        );
    }

    // ============================================================
    // ClipboardError Serialize 測試
    // ============================================================

    #[test]
    fn test_clipboard_access_error_serialize() {
        let error = ClipboardError::ClipboardAccess("no clipboard".to_string());
        let json = serde_json::to_string(&error).unwrap();
        assert_eq!(json, "\"Clipboard access failed: no clipboard\"");
    }

    #[test]
    fn test_keyboard_simulation_error_serialize() {
        let error = ClipboardError::KeyboardSimulation("event creation failed".to_string());
        let json = serde_json::to_string(&error).unwrap();
        assert_eq!(
            json,
            "\"Keyboard simulation failed: event creation failed\""
        );
    }

    #[test]
    fn test_error_serialize_roundtrip_is_string() {
        // ClipboardError 序列化後應為純字串，非物件
        let error = ClipboardError::ClipboardAccess("test".to_string());
        let value: serde_json::Value = serde_json::to_value(&error).unwrap();
        assert!(value.is_string(), "序列化結果應為 JSON 字串，非物件");
    }

    // ============================================================
    // ClipboardError Debug trait 測試
    // ============================================================

    #[test]
    fn test_clipboard_error_debug_format() {
        let error = ClipboardError::ClipboardAccess("test".to_string());
        let debug_str = format!("{:?}", error);
        assert!(debug_str.contains("ClipboardAccess"));
        assert!(debug_str.contains("test"));
    }

    #[test]
    fn test_keyboard_error_debug_format() {
        let error = ClipboardError::KeyboardSimulation("sim fail".to_string());
        let debug_str = format!("{:?}", error);
        assert!(debug_str.contains("KeyboardSimulation"));
        assert!(debug_str.contains("sim fail"));
    }
}
