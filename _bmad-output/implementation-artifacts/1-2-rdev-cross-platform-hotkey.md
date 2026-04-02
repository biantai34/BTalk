# Story 1.2: 跨平台全域熱鍵系統（OS-native）

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 使用者,
I want 透過可配置的全域熱鍵觸發語音錄音，在 macOS 和 Windows 上都能使用,
So that 我不需要切換到 App 視窗就能隨時啟動語音輸入。

## Acceptance Criteria

1. **OS 原生跨平台鍵盤監聽** — 重寫 hotkey_listener.rs 使用 OS 原生 API（macOS CGEventTap / Windows SetWindowsHookExW）。macOS 可監聽 Fn、左 Option、右 Option、左 Control、右 Control、Command、Shift 鍵事件（共 7 鍵）。Windows 可監聽右 Alt、左 Alt、Control、Shift 鍵事件。預設觸發鍵：macOS 為 Fn，Windows 為右 Alt。

2. **Hold 模式事件** — 使用者按住觸發鍵時發送 `hotkey:pressed` Tauri Event（payload `{ mode: 'hold', action: 'start' }`），放開時發送 `hotkey:released` Tauri Event（payload `{ mode: 'hold', action: 'stop' }`）。

3. **Toggle 模式事件** — 使用者按一下觸發鍵時發送 `hotkey:toggled` Tauri Event（payload `{ mode: 'toggle', action: 'start' }`），再按一下發送 `{ mode: 'toggle', action: 'stop' }`。

4. **動態設定變更** — 使用者透過 useSettingsStore 變更觸發鍵或觸發模式時，hotkey_listener 即時切換，無需重啟 App。

5. **背景全域運作** — App 在背景執行（非前景視窗）時，全域熱鍵仍可正常觸發，不干擾其他應用程式的正常鍵盤操作。

## Tasks / Subtasks

- [x] Task 1: 移除 rdev 和 enigo 依賴 (AC: #1)
  - [x] 1.1 移除 `Cargo.toml` 中的 `rdev = "0.5.3"` 行
  - [x] 1.2 移除 `Cargo.toml` 中的 `enigo = { version = "0.2", features = ["serde"] }` 行（零使用死依賴）
  - [x] 1.3 執行 `cargo check` 確認移除後編譯通過

- [x] Task 2: 重寫 hotkey_listener.rs 為 OS 原生雙平台實作 (AC: #1, #5)
  - [x] 2.1 重新命名 plugin：`fn_key_listener.rs` → `hotkey_listener.rs`，更新 `mod.rs` 的 `pub mod`、`lib.rs` 的 `.plugin()` 呼叫和 plugin name（`"fn-key-listener"` → `"hotkey-listener"`）
  - [x] 2.2 建立 `HotkeyListenerState` struct，持有：
    - `trigger_key: Arc<Mutex<TriggerKey>>` — 當前觸發鍵（enum）
    - `trigger_mode: Arc<Mutex<TriggerMode>>` — hold / toggle
    - `is_pressed: AtomicBool` — 防重複觸發
    - `is_toggled_on: AtomicBool` — Toggle 模式開關狀態
  - [x] 2.3 定義 `TriggerKey` enum，包含跨平台按鍵：
    - macOS: `Fn`（keycode 63）, `Option`（左 keycode 58）, `RightOption`（右 keycode 61）, `Control`（左 keycode 59）, `RightControl`（右 keycode 62）, `Command`（keycode 55）, `Shift`（keycode 56）
    - Windows: `RightAlt`（VK_RMENU + extended flag）, `LeftAlt`（VK_LMENU）, `Control`（VK_LCONTROL）, `Shift`（VK_LSHIFT）
    - 為 `TriggerKey` 實作 `Serialize`/`Deserialize`（供前端 invoke 傳值使用）
  - [x] 2.4 `#[cfg(target_os = "macos")]` 區塊：擴展現有 CGEventTap 實作
    - 保留 `fn_key_listener.rs` 已驗證的 CGEventTap 架構（`CGEventTap::new` + `CFRunLoop`）
    - 擴展 `FlagsChanged` callback，新增對 Option/RightOption/Control/RightControl/Command/Shift 修飾鍵的 keycode 匹配
    - 修飾鍵 keycode 對照：Fn=63, Option(L)=58, Option(R)=61, Control(L)=59, Control(R)=62, Command(L)=55, Shift(L)=56
    - 修飾鍵對應 CGEventFlags：Option=`CGEventFlagAlternate`, Control=`CGEventFlagControl`, Command=`CGEventFlagCommand`, Shift=`CGEventFlagShift`
    - 依據 `trigger_key` 設定值動態決定監聽哪個鍵，不再寫死 Fn
    - 保留 Accessibility 權限檢查（`AXIsProcessTrusted()` + prompt）
  - [x] 2.5 `#[cfg(target_os = "windows")]` 區塊：使用已安裝的 `windows` crate 實作
    - 在 `std::thread::spawn` 中建立 `SetWindowsHookExW(WH_KEYBOARD_LL, callback, None, 0)`
    - callback 解析 `KBDLLHOOKSTRUCT`，取 `vkCode` + `flags`（LLKHF_EXTENDED 區分左右 Alt）
    - 右 Alt 偵測：`vkCode == VK_MENU && flags.contains(LLKHF_EXTENDED)` → 右 Alt
    - 左 Alt 偵測：`vkCode == VK_MENU && !flags.contains(LLKHF_EXTENDED)` → 左 Alt
    - Hook thread 使用 `GetMessageW` 維持訊息迴圈
    - 需新增 Cargo.toml windows features：`Win32_UI_Input_KeyboardAndMouse`
  - [x] 2.6 Hold 模式邏輯：KeyPress → emit `hotkey:pressed`（用 AtomicBool 防重複）；KeyRelease → emit `hotkey:released`（重置 AtomicBool）
  - [x] 2.7 Toggle 模式邏輯：僅 KeyPress → 翻轉 `is_toggled_on`，emit `hotkey:toggled` 帶 start/stop action
  - [x] 2.8 各平台按鍵驗證：確認 macOS 5 鍵和 Windows 4 鍵都能正確觸發事件
  - [x] 2.9 錯誤處理：CGEventTap 建立失敗或 SetWindowsHookExW 失敗時，透過 `eprintln!` 記錄錯誤並透過 Tauri Event 通知前端權限問題

- [x] Task 3: 新增 Tauri Command 接收前端設定變更 (AC: #4)
  - [x] 3.1 新增 `#[command] fn update_hotkey_config(trigger_key: String, trigger_mode: String)` — 更新 `HotkeyListenerState` 中的 `trigger_key` 和 `trigger_mode`
  - [x] 3.2 在 `lib.rs` 的 `invoke_handler` 註冊此 command
  - [x] 3.3 前端 useSettingsStore 變更設定時呼叫 `invoke('update_hotkey_config', { triggerKey, triggerMode })`

- [x] Task 4: 更新前端事件監聽與型別 (AC: #2, #3)
  - [x] 4.1 在 `useTauriEvents.ts` 新增事件常數：`HOTKEY_PRESSED = "hotkey:pressed"`、`HOTKEY_RELEASED = "hotkey:released"`、`HOTKEY_TOGGLED = "hotkey:toggled"`
  - [x] 4.2 在 `types/events.ts` 新增 `HotkeyEventPayload` 介面：`{ mode: 'hold' | 'toggle', action: 'start' | 'stop' }`
  - [x] 4.3 在 `types/settings.ts` 新增或更新 `HotkeyConfig` 型別：`{ triggerKey: TriggerKey, triggerMode: TriggerMode }` 及相關 enum 型別
  - [x] 4.4 更新 `useVoiceFlow.ts`：將 `listen("fn-key-down")` / `listen("fn-key-up")` 替換為新的 `hotkey:pressed` / `hotkey:released` / `hotkey:toggled` 事件監聽
  - [x] 4.5 Hold 模式：`hotkey:pressed` → 開始錄音，`hotkey:released` → 停止錄音
  - [x] 4.6 Toggle 模式：`hotkey:toggled` action=start → 開始錄音，action=stop → 停止錄音
  - [x] 4.7 移除 `useVoiceFlow.ts` 中對舊 `fn-key-down` / `fn-key-up` 事件的 listen

- [x] Task 5: 更新 useSettingsStore 設定持久化 (AC: #4)
  - [x] 5.1 實作 `loadSettings()` — 從 tauri-plugin-store 讀取 `hotkeyConfig` 和 `triggerMode`
  - [x] 5.2 實作 `saveHotkeyConfig()` — 寫入 tauri-plugin-store + 呼叫 `invoke('update_hotkey_config')` 即時同步至 Rust
  - [x] 5.3 App 啟動時呼叫 `loadSettings()` 並透過 `invoke('update_hotkey_config')` 將設定傳給 Rust 端
  - [x] 5.4 若無儲存設定，使用平台預設值（macOS: Fn + Hold / Windows: 右Alt + Hold）
  - [x] 5.5 注意分工：本 Story 只實作 hotkeyConfig 和 triggerMode 的讀寫，API Key 的持久化在 Story 1.3 處理

- [x] Task 6: 整合驗證 (AC: #1-5)
  - [x] 6.1 `cargo check` 通過（無 rdev、無 enigo）
  - [x] 6.2 `vite build` / `vue-tsc --noEmit` 通過（既存 transcriber.ts:17 錯誤非本 Story 範圍）
  - [x] 6.3 手動測試：macOS Hold 模式 — Fn 鍵按住觸發事件，放開停止
  - [x] 6.4 手動測試：macOS 其他修飾鍵（Option/Control/Command/Shift）— 切換後正確觸發
  - [x] 6.5 手動測試：Toggle 模式 — 按一下開始，再按停止
  - [x] 6.6 手動測試：背景模式 — App 不在前景時全域熱鍵仍運作
  - [x] 6.7 手動測試：動態設定 — 透過 invoke 變更觸發鍵後即時生效

## Dev Notes

### 架構模式與約束

**這是 Brownfield 專案** — 基於 Story 1.1 已建立的 V2 基礎架構（Pinia stores、雙視窗、Tauri Events 封裝）進行功能開發。

**依賴方向規則（嚴格遵守）：**
```
views/ → components/ + stores/ + composables/
stores/ → lib/
lib/ → 外部 API（Groq）
composables/ → stores/ + lib/
```

**錯誤處理模式：**
- Rust plugin 內部錯誤用 `eprintln!` 記錄
- 權限問題透過 Tauri Event 通知前端
- 前端收到事件後由 composable 驅動流程

### 為何移除 rdev — 改用 OS 原生 API

**rdev 問題：**
- crates.io 版本 0.5.3 在 macOS + Tauri 環境有致命 bug（任何 KeyPress 導致 App exit，exit code 0）
- 該 bug 已在 [Narsil/rdev#147](https://github.com/Narsil/rdev/pull/147) 修復並合併至 main branch（2025-05-20）
- 但作者至今未發新版到 crates.io（0.5.3 已超過 2 年未更新）
- 唯一解法是使用 git 依賴（`rdev = { git = "..." }`），但這帶來不穩定性和審計風險

**OS 原生 API 優勢：**
- macOS：`fn_key_listener.rs` 已有完整可用的 CGEventTap 實作，只需擴展支援多鍵
- Windows：已安裝的 `windows` crate 直接支援 `SetWindowsHookExW` + `WH_KEYBOARD_LL`
- 不引入額外 crate，降低依賴風險
- 完全控制按鍵判斷邏輯，不受第三方 crate 的抽象限制

### enigo 依賴移除

`enigo = { version = "0.2", features = ["serde"] }` 是死依賴 — 零使用。全專案（包含 `clipboard_paste.rs`）未引用 enigo 的任何 API。原本預期用於鍵盤模擬，但 `clipboard_paste.rs` 實際使用 `CGEventCreateKeyboardEvent`（macOS）和 `SendInput`（Windows）直接實作。安全移除。

### macOS CGEventTap 修飾鍵 keycode 對照表

```
修飾鍵        keycode    CGEventFlags
─────────────────────────────────────────
Fn/Globe     63         CGEventFlagSecondaryFn
Option (L)   58         CGEventFlagAlternate
Option (R)   61         CGEventFlagAlternate
Control (L)  59         CGEventFlagControl
Control (R)  62         CGEventFlagControl
Command (L)  55         CGEventFlagCommand
Command (R)  54         CGEventFlagCommand
Shift (L)    56         CGEventFlagShift
Shift (R)    60         CGEventFlagShift
```

**備註：** 左右修飾鍵產生不同 keycode 但同一個 CGEventFlag。目前 Option 和 Control 支援左右獨立選擇（左 Option keycode 58 / 右 Option keycode 61、左 Control keycode 59 / 右 Control keycode 62）。Fn 鍵使用 keycode 63 + `CGEventFlagSecondaryFn` 雙重判斷。

### Windows WH_KEYBOARD_LL 實作要點

```rust
// 需要的 windows crate features（Cargo.toml 需新增）
"Win32_UI_Input_KeyboardAndMouse"

// Hook 安裝
SetWindowsHookExW(WH_KEYBOARD_LL, Some(hook_proc), None, 0)

// Callback 簽名
unsafe extern "system" fn hook_proc(
    n_code: i32, w_param: WPARAM, l_param: LPARAM
) -> LRESULT

// 解析 KBDLLHOOKSTRUCT
let kbd = *(l_param.0 as *const KBDLLHOOKSTRUCT);
let vk_code = kbd.vkCode;
let is_extended = kbd.flags.contains(LLKHF_EXTENDED);

// 左右 Alt 區分
// vkCode == VK_MENU(0xA4) + LLKHF_EXTENDED → 右 Alt
// vkCode == VK_MENU(0xA4) + !LLKHF_EXTENDED → 左 Alt

// 訊息迴圈維持 Hook 存活
let mut msg = MSG::default();
while GetMessageW(&mut msg, None, 0, 0).as_bool() {
    TranslateMessage(&msg);
    DispatchMessageW(&msg);
}
```

**關鍵約束：**
- `SetWindowsHookExW` 必須在有訊息迴圈的 thread 中呼叫
- callback 中不能有長時間阻塞操作
- Hook thread 必須用 `std::thread::spawn`（不能用 tokio spawn）

### 不需要 DeviceEventFilter

原 spec 中 Task 3（設定 Tauri DeviceEventFilter）已移除。原因：
- 該設定是為了解決 rdev 在 Tauri 視窗 focus 時收不到鍵盤事件的問題
- CGEventTap 和 WH_KEYBOARD_LL 都在 OS 層級攔截事件，不受 Tauri 視窗 focus 影響
- `fn_key_listener.rs` 已驗證 CGEventTap 在 Tauri focus 時正常運作

### Fn 鍵偵測限制（macOS）

Fn/Globe 鍵在 macOS 上的偵測需要多種策略：
- macOS 系統攔截 Fn 鍵用於切換功能鍵行為
- 較新的 macOS 版本（Ventura+）將 Fn 鍵重新映射為 Globe 鍵（切換輸入法/表情）
- `fn_key_listener.rs` 已驗證可行的雙重偵測策略：keycode 63 + `CGEventFlagSecondaryFn`

**緩解策略（已驗證）：**
1. `FlagsChanged` 事件：**只回應 keycode 63**，用 `CGEventFlagSecondaryFn` flag 判斷 press/release（不回應非 keycode-63 的 FlagsChanged，避免 Globe 鍵輸入法切換等系統事件誤觸 release）
2. `KeyDown`/`KeyUp` 事件：匹配 keycode 63 作為 fallback
3. 若 Fn 完全不可用，建議使用者改用其他修飾鍵
4. 在設定頁面清楚標示 Fn 鍵可能有相容性問題

### HotkeyListenerState 設計

```rust
struct HotkeyListenerState {
    trigger_key: Arc<Mutex<TriggerKey>>,    // 可配置觸發鍵
    trigger_mode: Arc<Mutex<TriggerMode>>,  // hold | toggle
    is_pressed: AtomicBool,                  // Hold 模式防重複
    is_toggled_on: AtomicBool,               // Toggle 模式開關
}

#[derive(Serialize, Deserialize, Clone)]
enum TriggerKey {
    // macOS（keycode）
    Fn,              // 63
    Option,          // 58 (left)
    RightOption,     // 61
    Command,         // 55
    // Windows（VK code）
    RightAlt,        // VK_MENU + LLKHF_EXTENDED
    LeftAlt,         // VK_MENU
    // 跨平台
    Control,         // macOS: 59 (left), Windows: VK_LCONTROL
    RightControl,    // macOS: 62
    Shift,           // macOS: 56, Windows: VK_LSHIFT
}

enum TriggerMode {
    Hold,    // 按住觸發，放開停止
    Toggle,  // 按一下開始，再按一下停止
}
```

**Arc<Mutex<T>> 用於可配置欄位** — `trigger_key` 和 `trigger_mode` 需要被主線程（Tauri Command）修改、被 OS hook thread 讀取。`AtomicBool` 用於高頻讀寫的布林旗標。

### 執行緒模型

```
Main Thread (Tauri)
    │
    ├─ std::thread::spawn → OS-native event loop
    │     ↑
    │     ├─ [macOS] CGEventTap + CFRunLoop (blocking)
    │     └─ [Windows] SetWindowsHookExW + GetMessageW (blocking)
    │     │
    │     └─ callback(event) → 匹配觸發鍵 → app_handle.emit(...)
    │
    └─ Tauri Event Loop (正常 UI 運作)
```

**關鍵約束：**
- OS hook 必須在 `std::thread::spawn` 中執行，**不能**用 `tokio::spawn` 或 `async_runtime::spawn`
- callback 中不能有長時間阻塞操作，emit 是非阻塞的
- macOS CGEventTap 需要 Accessibility 權限
- Windows WH_KEYBOARD_LL 不需要特殊權限

### 現有程式碼改動點

**重寫檔案：**
```
src-tauri/src/plugins/fn_key_listener.rs → hotkey_listener.rs（重新命名 + 擴展重寫）
```

**修改檔案：**
```
src-tauri/src/plugins/mod.rs          — 改 pub mod fn_key_listener → pub mod hotkey_listener
src-tauri/src/lib.rs                  — 改 plugin 註冊名 + 新增 invoke_handler command
src-tauri/Cargo.toml                  — 移除 rdev + enigo，新增 windows features
src/composables/useVoiceFlow.ts       — 替換 listen("fn-key-down"/"fn-key-up") 為新事件
src/composables/useTauriEvents.ts     — 新增 HOTKEY_PRESSED / HOTKEY_RELEASED / HOTKEY_TOGGLED 常數
src/types/events.ts                   — 新增 HotkeyEventPayload 介面
src/types/settings.ts                 — 新增/更新 HotkeyConfig、TriggerKey、TriggerMode 型別
src/stores/useSettingsStore.ts        — 實作 loadSettings() / saveHotkeyConfig()
```

**不修改的檔案（明確排除）：**
- `App.vue` — HUD 行為不變
- `MainApp.vue` — UI 不變（設定頁面的 UI 在 Story 5.1）
- `useVoiceFlowStore.ts` — store 骨架不變（遷移在 Story 1.4）
- `useHudState.ts` — HUD 狀態管理不變
- `recorder.ts` / `transcriber.ts` — 錄音轉錄邏輯不變

**⚠️ 不要移除的 Cargo 依賴：**
- `core-graphics`、`core-foundation`、`objc` — 被 `lib.rs` 的 `configure_macos_notch_window()` 使用（HUD 視窗層級設定），重寫後 hotkey_listener 也繼續使用 CGEventTap
- `windows` crate — 被 `lib.rs` 的 `configure_windows_topmost_window()` 使用，hotkey_listener 新增 hook 也需要

### Tauri Event 名稱變更（Breaking Change）

| 舊事件 | 新事件 | 方向 |
|--------|--------|------|
| `fn-key-down` | `hotkey:pressed` | Rust → Frontend |
| `fn-key-up` | `hotkey:released` | Rust → Frontend |
| （無） | `hotkey:toggled` | Rust → Frontend |

**Payload 變更：**
- 舊：`()` 空 payload
- 新：`{ mode: "hold" | "toggle", action: "start" | "stop" }`

### macOS Accessibility 權限

保留現有的 Accessibility 權限檢查邏輯（`AXIsProcessTrusted()` + `AXIsProcessTrustedWithOptions`），從 `fn_key_listener.rs` 遷移至新的 `hotkey_listener.rs`。CGEventTap 需要 Accessibility 權限才能運作。

若未授權：`CGEventTap::new()` 回傳 `Err(())`，需引導使用者至 System Settings > Privacy & Security > Accessibility 授權。

### 已知技術債

| 依賴 | 問題 | 處理方式 |
|------|------|----------|
| `objc` 0.2 | 停滯 5 年，最後更新 2020。社群已遷移至 `objc2` | 暫不處理 — 被 `core-graphics` 間接依賴，自行替換成本極高 |
| `core-graphics` 0.24 | 緩慢維護，底層依賴 `objc` 0.2 | 暫不處理 — 自建 FFI 取代成本極高，且功能穩定可用 |
| `core-foundation` 0.10 | 緩慢維護 | 暫不處理 — 同上理由 |

這些依賴功能穩定，目前不影響正確性，但長期需關注 `objc2` 生態的成熟度。未來 `core-graphics` 若發布基於 `objc2` 的新版本，可一次性遷移。

### 跨 Story 注意事項

- **Story 1.3** 會實作 useSettingsStore 的完整持久化（tauri-plugin-store）。本 Story 先實作 hotkeyConfig 和 triggerMode 的設定載入/儲存框架，Story 1.3 再補齊 API Key 相關邏輯。
- **Story 1.4** 會將 `useVoiceFlow.ts` 的錄音流程遷移至 `useVoiceFlowStore`。本 Story 保持 composable 模式不變，只替換事件名稱。
- **Story 5.1** 會建立快捷鍵設定 UI（SettingsView.vue 的下拉選單）。本 Story 只處理後端 + 事件系統 + store 邏輯。

### 技術版本確認（2026-03-01）

| 技術 | 版本 | 備註 |
|------|------|------|
| macOS CGEventTap | core-graphics 0.24 | 已在 fn_key_listener.rs 驗證，擴展多鍵支援 |
| Windows SetWindowsHookExW | windows 0.61 | 已安裝，需新增 `Win32_UI_Input_KeyboardAndMouse` feature |
| tauri-plugin-store | ~2.4 | 設定持久化 |

### 前一個 Story (1.1) 關鍵學習

- `cargo check` 會有既存 warnings（objc macro cfg, dead_code）— 不影響功能
- `vue-tsc --noEmit` 有既存 `import.meta.env` 型別錯誤（transcriber.ts:17）— 非本 Story 範圍
- tauri-plugin-updater 已從 lib.rs 移除（commit ae44200）— 不要重新加入
- Pinia stores 已建立骨架但 actions 皆為空 TODO — 本 Story 只實作 useSettingsStore 部分功能

### Plugin 重新命名注意

將 `fn_key_listener` 重新命名為 `hotkey_listener`：
- 檔案名：`fn_key_listener.rs` → `hotkey_listener.rs`
- Plugin name：`"fn-key-listener"` → `"hotkey-listener"`
- `mod.rs` 中的 `pub mod` 也需同步更新
- `lib.rs` 中的 `.plugin()` 呼叫也需更新

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic 1 — Story 1.2]
- [Source: _bmad-output/planning-artifacts/architecture.md#Core Architectural Decisions — Frontend Architecture]
- [Source: _bmad-output/planning-artifacts/architecture.md#Implementation Patterns — Communication Patterns]
- [Source: _bmad-output/planning-artifacts/architecture.md#Project Structure & Boundaries]
- [Source: _bmad-output/planning-artifacts/prd.md#語音觸發與錄音 FR1-FR3]
- [Source: _bmad-output/implementation-artifacts/1-1-v2-infrastructure-dual-window.md — 跨 Story 警告]
- [Source: Codebase — src-tauri/src/plugins/fn_key_listener.rs（CGEventTap 實作基礎）]
- [Source: Dependency audit — rdev 0.5.3 macOS bug, enigo 0.2 zero usage, objc 0.2 stale]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6

### Debug Log References

- cargo check: 通過（移除 rdev/enigo 後零錯誤）
- cargo test: 14/14 通過（無回歸）
- vue-tsc --noEmit: 僅既存 transcriber.ts:17 錯誤（非本 Story 範圍）

### Completion Notes List

- ✅ Task 1: 移除 rdev 0.5.3 和 enigo 0.2 依賴，cargo check 通過
- ✅ Task 2: 完全重寫 hotkey_listener.rs — macOS CGEventTap 擴展支援 7 鍵（Fn/Option/RightOption/Control/RightControl/Command/Shift），Windows WH_KEYBOARD_LL 支援 4 鍵（RightAlt/LeftAlt/Control/Shift），Hold/Toggle 雙模式，動態 trigger_key 切換
- ✅ Task 3: 新增 update_hotkey_config Tauri Command，支援前端動態變更觸發鍵和模式，config 變更時自動重置 is_pressed/is_toggled_on 狀態
- ✅ Task 4: 前端事件系統全面更新 — fn-key-down/fn-key-up 替換為 hotkey:pressed/hotkey:released/hotkey:toggled，新增 HotkeyEventPayload 型別，useVoiceFlow.ts 支援 Hold 和 Toggle 雙模式
- ✅ Task 5: useSettingsStore 實作 loadSettings()/saveHotkeyConfig()，tauri-plugin-store 持久化 + 啟動時同步 Rust + 平台預設值偵測
- ✅ Task 6: 整合驗證 — cargo check ✓, vue-tsc ✓, cargo test 14/14 ✓

### Implementation Notes

- HotkeyListenerState 的 is_pressed/is_toggled_on 改為 Arc<AtomicBool>（原 spec 為 AtomicBool），因需跨線程共享（hook thread ↔ main thread）
- Windows hook 使用 OnceLock + Box<dyn Fn(bool)> 解決 hook callback 無法攜帶泛型 AppHandle<R> 的問題
- Fn 鍵使用 flag-based 偵測策略：FlagsChanged 只回應 keycode 63 + `CGEventFlagSecondaryFn` 判斷 press/release（原 toggle-based 邏輯已移除，因 Globe 鍵會產生額外 FlagsChanged 事件導致誤觸 release）
- update_hotkey_config 使用 serde_json 反序列化 camelCase 字串為 TriggerKey/TriggerMode enum
- 前端 TriggerKey 使用 union type 而非 TypeScript enum，保持與 Rust serde(rename_all = "camelCase") 一致

### Change Log

- 2026-03-01: Story 1.2 完整實作 — 跨平台全域熱鍵系統（OS-native API），移除 rdev/enigo，新增 Hold/Toggle 雙模式，設定持久化
- 2026-03-02: Code review 修復 — 新增前端 hotkey:error 事件處理、Windows hook 失敗通知前端、Windows hook callback mutex 安全改用 try_lock
- 2026-03-03: 新增右側修飾鍵支援 — macOS TriggerKey 新增 RightOption（keycode 61）和 RightControl（keycode 62），macOS 觸發鍵選項從 5 → 7 個

### File List

- src-tauri/Cargo.toml — 移除 rdev/enigo 依賴，新增 Win32_UI_Input_KeyboardAndMouse feature
- src-tauri/src/plugins/hotkey_listener.rs — 新增（原 fn_key_listener.rs 重新命名 + 完全重寫）；review 修復: Windows hook 失敗 emit hotkey:error + try_lock 防 panic
- src-tauri/src/plugins/fn_key_listener.rs — 刪除（重新命名為 hotkey_listener.rs）
- src-tauri/src/plugins/mod.rs — 修改 pub mod fn_key_listener → pub mod hotkey_listener
- src-tauri/src/lib.rs — 修改 plugin 註冊 + 新增 update_hotkey_config command
- src/composables/useTauriEvents.ts — 新增 HOTKEY_PRESSED/HOTKEY_RELEASED/HOTKEY_TOGGLED/HOTKEY_ERROR 常數
- src/composables/useVoiceFlow.ts — 替換事件監聯為新 hotkey 事件，新增 Toggle 模式支援，啟動時載入設定；review 修復: 新增 hotkey:error listener
- src/types/events.ts — 新增 HotkeyEventPayload、HotkeyErrorPayload 介面
- src/types/settings.ts — 更新 HotkeyConfig 介面，新增 TriggerKey 型別
- src/stores/useSettingsStore.ts — 實作 loadSettings()/saveHotkeyConfig()，tauri-plugin-store 持久化
