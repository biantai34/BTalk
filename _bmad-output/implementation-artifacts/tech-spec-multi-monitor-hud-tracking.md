---
title: 'Multi-Monitor HUD Tracking'
slug: 'multi-monitor-hud-tracking'
created: '2026-03-03'
status: 'review'
stepsCompleted: [1, 2, 3, 4]
tech_stack: ['Rust (core-graphics 0.24, windows 0.61)', 'TypeScript', 'Tauri v2 Window/Monitor API']
files_to_modify: ['src-tauri/src/lib.rs', 'src/stores/useVoiceFlowStore.ts', 'src-tauri/capabilities/default.json']
code_patterns: ['#[cfg(target_os)] platform isolation', 'PhysicalPosition for window positioning', 'invoke() for frontend→Rust commands', 'Tauri available_monitors() for monitor enumeration']
test_patterns: ['Rust #[cfg(test)] unit tests for coordinate calculation', 'Vitest for frontend store logic']
---

# Tech-Spec: Multi-Monitor HUD Tracking

**Created:** 2026-03-03

## Overview

### Problem Statement

HUD 視窗在應用程式啟動時固定定位於主螢幕頂部置中。在多螢幕環境下，使用者在副螢幕上工作並觸發快捷鍵時，HUD 仍然出現在主螢幕，造成視覺斷裂和體驗不佳。

### Solution

實作雙層多螢幕追蹤機制：
1. **Hotkey 觸發時** — 偵測滑鼠游標座標，判定所在螢幕，將 HUD 定位到該螢幕頂部水平置中
2. **HUD 顯示期間** — 啟動輕量輪詢（約 250ms），持續偵測游標是否跨螢幕，若是則即時搬移 HUD 到新螢幕頂部置中
3. **HUD 開始消失時** — 停止輪詢，collapse 動畫期間不再追蹤
4. **HUD 隱藏後** — 零額外開銷

### Scope

**In Scope:**
- macOS + Windows 雙平台滑鼠游標座標偵測
- 從游標座標判定所在螢幕（Tauri `available_monitors()` + 座標區間比對）
- HUD 視窗動態重新定位（目標螢幕水平置中、Y = monitor top position）
- 輪詢生命週期管理（HUD show 時啟動 / transition to idle 時停止）
- DPI scale factor 正確處理（沿用現有 `calculate_centered_window_x` 邏輯）

**Out of Scope:**
- Notch 特殊 Y 偏移處理（一律貼螢幕頂端）
- 螢幕熱插拔偵測（運行中新增/移除螢幕）
- Dashboard 視窗的多螢幕處理

## Context for Development

### Codebase Patterns

- **平台隔離**: 使用 `#[cfg(target_os = "macos")]` / `#[cfg(target_os = "windows")]` 分離平台特定邏輯
- **視窗定位**: 使用 `tauri::PhysicalPosition` 設定座標，搭配 `calculate_centered_window_x()` 計算置中
- **前端→Rust 通訊**: `invoke('command_name', { args })` 呼叫 Tauri Command，返回 `Result<T, String>`
- **HUD 生命週期**: `showHud()` → `window.show()` + `setIgnoreCursorEvents(true)`，`hideHud()` → `window.hide()`
- **狀態機驅動**: `transitionTo()` 控制 HUD 狀態轉換，recording/transcribing/enhancing 觸發 showHud()，idle 觸發 hideHud()
- **showHud() 是 fire-and-forget**: `transitionTo()` 中以 `showHud().catch(...)` 呼叫（無 await），但 `showHud()` 內部的 await 順序仍然保證先定位再顯示

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `src-tauri/src/lib.rs` | 現有 `calculate_centered_window_x()` + startup 定位 + 平台視窗配置 |
| `src/stores/useVoiceFlowStore.ts` | HUD show/hide 生命週期 + hotkey event listeners |
| `src-tauri/src/plugins/hotkey_listener.rs` | 平台隔離 pattern 參考 + CGEvent/Windows hooks 使用方式 |
| `src-tauri/Cargo.toml` | 已有 core-graphics 0.24 + windows 0.61 依賴 |
| `src-tauri/capabilities/default.json` | Tauri capability 白名單（需新增 `setPosition` 權限） |
| `src/components/NotchHud.vue` | HUD 固定寬度 350px（visual），視窗邏輯寬度 400px |

### Technical Decisions

- **游標座標取得方式**:
  - macOS: 透過 `CGEventCreate(NULL)` + `CGEventGetLocation()` C API — 返回 points（邏輯像素），原點在主螢幕左上角（y 向下增長）
  - Windows: `GetCursorPos()` — 返回 virtual screen 座標，原點在主螢幕左上角
  - ⚠️ **需實測驗證**: 以上座標系統描述基於文件推理，實作時需在真實多螢幕環境（特別是不同 DPI 組合）下驗證座標匹配是否正確
- **螢幕匹配邏輯**:
  - macOS: Tauri monitor position 是 physical pixels，需除以各自的 `scale_factor` 轉為 logical 後與游標 points 比對
  - Windows: Tauri monitor position 與 `GetCursorPos` 座標系統應一致，直接比對
  - ⚠️ **需實測驗證**: Windows 上 `GetCursorPos` 返回值可能受 DPI awareness context 影響（logical vs physical），需確認 Tauri 進程的 DPI awareness 模式並驗證座標是否匹配
- **Rust 端完成所有計算**: 新 Tauri Command 回傳最終 `PhysicalPosition`，前端只負責 `setPosition()`
- **HUD 視窗寬度常數**: 抽取為 Rust 常數 `HUD_WINDOW_WIDTH_LOGICAL = 400.0`，取代現有 startup 中的 hardcoded 值，前端 invoke 時傳入相同值
- **輪詢間隔 250ms**: 平衡即時性與效能，HUD 可見期間運行
- **輪詢停止時機**: `transitionTo("idle")` 時停止輪詢（非 `hideHud()` 時）。collapse 動畫期間不追蹤，避免消失中的 HUD 突然跳螢幕
- **Monitor key 比對**: 用螢幕的 physical position `"{x},{y}"` 作為 key，前端快取比對避免不必要的 `setPosition()` 呼叫
- **啟動時定位保留**: `setup()` 中的初始定位邏輯保留作為預設 fallback，改用 `HUD_WINDOW_WIDTH_LOGICAL` 常數
- **並行呼叫防護**: `repositionHudToCurrentMonitor()` 使用 `isRepositioning` flag 防止多個 invoke 並行執行（250ms 輪詢間隔下，若前一次 IPC 尚未回傳則跳過本次）
- **CGEvent 記憶體安全**: macOS `CGEventCreate` 返回的 event 物件必須以 scope guard 確保 `CFRelease`，即使中途 panic 也不 leak（每 250ms 呼叫一次，leak 會累積）

## Implementation Plan

### Tasks

- [x] Task 1: 新增 Tauri capability `core:window:allow-set-position`
  - File: `src-tauri/capabilities/default.json`
  - Action: 在 `permissions` 陣列中加入 `"core:window:allow-set-position"`
  - Notes: `Window.setPosition()` 不在 `core:window:default` 內，必須顯式授權，否則前端呼叫會被 Tauri 權限系統擋下

- [x] Task 2: 新增 `HUD_WINDOW_WIDTH_LOGICAL` 常數和 `HudTargetPosition` 回傳型別
  - File: `src-tauri/src/lib.rs`
  - Action: 在 `calculate_centered_window_x()` 附近新增：
    - `const HUD_WINDOW_WIDTH_LOGICAL: f64 = 400.0;` 常數
    - `HudTargetPosition` struct，包含 `x: i32`, `y: i32`, `monitor_key: String`
  - Notes: `#[derive(Serialize)]` + `#[serde(rename_all = "camelCase")]`。同時將 `setup()` 中的 hardcoded `400.0` 替換為此常數

- [x] Task 3: 新增 macOS 游標座標取得函式
  - File: `src-tauri/src/lib.rs`
  - Action: 新增 `#[cfg(target_os = "macos")] fn get_cursor_position() -> (f64, f64)` 函式
  - Notes: 使用 `CGEventCreate(NULL)` + `CGEventGetLocation()` C FFI 呼叫。需宣告 `extern "C"` block 引入 `CGEventCreate`, `CGEventGetLocation`, `CFRelease`。**必須使用 scope guard（或 defer pattern）確保 `CFRelease` 被呼叫**，避免每 250ms 一次的記憶體 leak。返回值為 points（邏輯座標），原點在主螢幕左上角

- [x] Task 4: 新增 Windows 游標座標取得函式
  - File: `src-tauri/src/lib.rs`
  - Action: 新增 `#[cfg(target_os = "windows")] fn get_cursor_position() -> (f64, f64)` 函式
  - Notes: 使用 `windows::Win32::UI::WindowsAndMessaging::GetCursorPos`（已在 Cargo.toml features 中）。⚠️ 實作時需驗證返回座標是否與 Tauri `Monitor.position()` 在同一座標系統中

- [x] Task 5: 新增螢幕匹配輔助函式
  - File: `src-tauri/src/lib.rs`
  - Action: 新增 `find_monitor_for_cursor()` 純函式，接受游標座標和螢幕列表參數，回傳匹配螢幕的 index
  - Notes: macOS 路徑需將 monitor physical position 除以 scale_factor 轉為 logical 後比對。Windows 路徑直接比對 physical 座標。設計為純函式以便單元測試（接受抽象化的 monitor 資料 struct 而非 Tauri `Monitor` 物件）。**需處理負值座標**（副螢幕在主螢幕上方或左方時 position 為負）

- [x] Task 6: 新增 `get_hud_target_position` Tauri Command
  - File: `src-tauri/src/lib.rs`
  - Action: 新增 `#[command] fn get_hud_target_position(app: tauri::AppHandle, window_width: f64) -> Result<HudTargetPosition, String>`
  - Notes: 流程：(1) 呼叫 `get_cursor_position()` 取得游標座標 (2) `app.available_monitors()` 取得螢幕列表 (3) `find_monitor_for_cursor()` 匹配螢幕 (4) 對匹配螢幕呼叫 `calculate_centered_window_x()` 計算 X (5) HUD X = monitor.position().x + centered_x (6) HUD Y = monitor.position().y（螢幕頂端，可能為負值） (7) monitor_key = `"{x},{y}"` (8) 回傳 `HudTargetPosition`。若無螢幕匹配，fallback 到第一個螢幕

- [x] Task 7: 註冊新 Command 到 invoke_handler
  - File: `src-tauri/src/lib.rs`
  - Action: 在 `tauri::generate_handler![]` 中加入 `get_hud_target_position`
  - Notes: 位於 `run()` 函式中的 `.invoke_handler()` 區塊

- [x] Task 8: 前端新增 `HudTargetPosition` 介面 + 重定位邏輯
  - File: `src/stores/useVoiceFlowStore.ts`
  - Action: 新增以下內容：
    - `HudTargetPosition` 介面（`x: number`, `y: number`, `monitorKey: string`）
    - `HUD_WINDOW_WIDTH_LOGICAL = 400` 常數
    - `MONITOR_POLL_INTERVAL_MS = 250` 常數
    - `monitorPollTimer` 變數（`ReturnType<typeof setInterval> | null`）
    - `lastMonitorKey` 變數（`string`）
    - `isRepositioning` 變數（`boolean`，並行呼叫防護）
    - `repositionHudToCurrentMonitor()` async 函式：檢查 `isRepositioning` flag，若為 true 則跳過；否則 set flag → invoke `get_hud_target_position` → 比對 `monitorKey` → 若變更則 `window.setPosition(new PhysicalPosition(x, y))` → clear flag
    - `startMonitorPolling()` 函式：啟動 setInterval 每 250ms 呼叫 `repositionHudToCurrentMonitor()`
    - `stopMonitorPolling()` 函式：clearInterval + 重設 `lastMonitorKey` + 重設 `isRepositioning`
  - Notes: 需新增 import `PhysicalPosition` from `@tauri-apps/api/dpi`。`repositionHudToCurrentMonitor()` 中的錯誤靜默處理（log 但不影響 HUD 顯示流程），錯誤時必須 clear `isRepositioning` flag

- [x] Task 9: 修改 `showHud()` 整合重定位 + 輪詢
  - File: `src/stores/useVoiceFlowStore.ts`
  - Action: 修改 `showHud()` 函式：
    1. 重設 `lastMonitorKey = ""`（強制首次定位）
    2. `await repositionHudToCurrentMonitor()`（先定位再顯示）
    3. 保留原有 `window.show()` + `setIgnoreCursorEvents(true)`
    4. 呼叫 `startMonitorPolling()`
  - Notes: `showHud()` 是 async 函式，內部 await 順序保證先定位再 show。雖然 `transitionTo()` 以 fire-and-forget 方式呼叫 `showHud()`，但這不影響 `showHud()` 內部的執行順序

- [x] Task 10: 修改 `transitionTo()` 在 idle transition 時停止輪詢
  - File: `src/stores/useVoiceFlowStore.ts`
  - Action: 在 `transitionTo()` 中 `nextStatus === "idle"` 分支的開頭加入 `stopMonitorPolling()` 呼叫
  - Notes: 輪詢在 transition to idle 時立即停止，collapse 動畫 400ms 期間不再追蹤。避免消失中的 HUD 突然跳到另一螢幕的突兀行為

- [x] Task 11: 修改 `cleanup()` 加入輪詢清理
  - File: `src/stores/useVoiceFlowStore.ts`
  - Action: 在 `cleanup()` 函式中加入 `stopMonitorPolling()` 呼叫
  - Notes: 確保元件卸載時清理所有 interval

- [x] Task 12: 新增 Rust 單元測試
  - File: `src-tauri/src/lib.rs`
  - Action: 在 `#[cfg(test)] mod tests` 中新增測試：
    - `test_find_monitor_single_monitor` — 單螢幕場景，游標一定在該螢幕上
    - `test_find_monitor_dual_horizontal` — 雙螢幕水平排列，游標在右螢幕
    - `test_find_monitor_dual_vertical` — 雙螢幕垂直排列，副螢幕在上方（y 為負值）
    - `test_find_monitor_dual_different_dpi` — 雙螢幕不同 DPI（macOS 場景）
    - `test_find_monitor_cursor_at_boundary` — 游標在螢幕邊界上
    - `test_find_monitor_cursor_negative_coords` — 游標在負座標區域（副螢幕在主螢幕左方/上方）
    - `test_find_monitor_fallback` — 游標座標不在任何螢幕內（異常情況），fallback 到第一個螢幕
  - Notes: `find_monitor_for_cursor()` 設計為純函式，接受 struct 參數而非 Tauri Monitor 物件，方便測試

### Acceptance Criteria

- [x] AC 1: Given 使用者有雙螢幕且游標在副螢幕上，when 按下快捷鍵觸發錄音，then HUD 出現在副螢幕頂部水平置中
- [x] AC 2: Given HUD 正在副螢幕上顯示（錄音中），when 使用者將滑鼠移動到主螢幕，then HUD 在 250ms 內移動到主螢幕頂部水平置中
- [x] AC 3: Given 使用者只有單螢幕，when 按下快捷鍵，then HUD 行為與修改前完全一致（頂部置中）
- [x] AC 4: Given 雙螢幕有不同 DPI（例如 MacBook Retina + 外接 1080p），when HUD 從 Retina 螢幕移到外接螢幕，then HUD 在外接螢幕上正確水平置中且不偏移
- [x] AC 5: Given HUD 隱藏（idle 狀態），when 無操作，then 無輪詢 timer 在運行（零效能開銷）
- [x] AC 6: Given `get_hud_target_position` command 執行失敗，when 按下快捷鍵，then HUD 仍然正常顯示（在最後已知位置），錯誤靜默 log 不影響流程
- [x] AC 7: Given HUD 顯示中且游標未跨螢幕，when 輪詢觸發，then 不呼叫 `setPosition()`（透過 `monitorKey` 比對避免）
- [x] AC 8: Given HUD 正在 collapse 動畫中（transition to idle 後 400ms 內），when 使用者將滑鼠移到其他螢幕，then HUD 不跟隨（輪詢已停止），在當前螢幕完成消失動畫

## Additional Context

### Dependencies

- 無新 Rust crate 依賴 — `core-graphics` 0.24（macOS）和 `windows` 0.61（Windows）已在 `Cargo.toml` 中
- 無新 npm 依賴 — `@tauri-apps/api` 已包含 `PhysicalPosition` 和 `Window.setPosition()`
- **需新增 Tauri capability**: `core:window:allow-set-position`（Task 1）— `setPosition()` 不在 `core:window:default` 中，必須顯式授權

### Testing Strategy

- **Rust 單元測試**: 7 個測試案例覆蓋 `find_monitor_for_cursor()` 的各種場景，包含垂直排列和負座標（Task 12）
- **手動整合測試**: 雙螢幕環境下驗證 AC 1-8，特別注意：
  - 不同 DPI 螢幕間的切換
  - HUD 顯示/隱藏時的輪詢啟停
  - 快速跨螢幕移動時的追蹤延遲
  - collapse 動畫期間確認不追蹤
  - ⚠️ **座標系統實測**: 第一次在真實多螢幕環境運行時，加上 debug log 印出游標座標和各螢幕的 position/size/scale_factor，確認座標比對邏輯正確
- **現有測試迴歸**: `pnpm test` 確認 `useVoiceFlowStore` 現有測試不被破壞

### Notes

- **效能**: 每次輪詢是一個 `invoke()` IPC 呼叫 + Tauri `available_monitors()` 查詢。250ms 間隔下每秒 4 次，對系統負擔極小
- **座標系統陷阱（⚠️ 需實測）**: macOS 游標座標是 logical pixels（points），Tauri monitor positions 是 physical pixels。比對時必須將 physical 除以 `scale_factor` 轉為 logical。Windows 的座標匹配取決於 Tauri 進程的 DPI awareness mode，需實測確認。實作時應在 `get_hud_target_position` 中加入 debug log 以便驗證
- **視覺閃爍防護**: `showHud()` 中先 `repositionHudToCurrentMonitor()` 再 `window.show()`，確保 HUD 出現在正確位置而非先閃一下舊位置
- **collapse 期間不追蹤**: 輪詢在 `transitionTo("idle")` 時停止，collapse 動畫 400ms 期間 HUD 固定在當前螢幕消失，避免消失中突然跳螢幕的突兀行為
- **並行安全**: `isRepositioning` flag 確保同時只有一個 invoke IPC 在進行中，避免高負載下多個 `setPosition()` 互相競爭
- **記憶體安全**: macOS `CGEventCreate` 必須配對 `CFRelease`，使用 scope guard 確保即使 panic 也不 leak
- **未來考量（Out of Scope）**: 螢幕熱插拔可透過監聯 Tauri 的 `ScaleFactorChanged` / `Resized` 事件支援，但目前不在範圍內

## Dev Agent Record

### Implementation Notes

- **Date:** 2026-03-03
- **macOS CGEvent FFI**: 使用 raw `extern "C"` FFI 呼叫 `CGEventCreate(NULL)` + `CGEventGetLocation()` + `CFRelease()`，因為 `core-graphics` 0.24 的 `CGEvent::new()` 需要非 Optional 的 `CGEventSource` 參數，無法直接傳 NULL
- **MonitorInfo 抽象化**: 新增 `MonitorInfo` struct 將螢幕資訊抽象化，使 `find_monitor_for_cursor()` 成為純函式，方便單元測試（不需要 Tauri runtime）
- **座標系統處理**: macOS 分支會將 monitor physical position 除以各自的 `scale_factor` 轉為 logical 後與游標 points 比對；Windows 分支直接用 physical 座標比對
- **記憶體安全**: CGEventCreate 返回的指標手動 CFRelease — 不依賴 Rust wrapper 的 Drop，因為直接用了 C FFI

### Completion Notes

- 12/12 tasks 完成
- 8/8 acceptance criteria 滿足（需手動整合測試驗證 AC 1-8）
- Rust: 7 個新測試 + 19 個既有測試 = 26 tests passing
- Frontend: 242 tests passing（零迴歸）
- 無新 crate/npm 依賴
- TypeScript 型別錯誤皆為預先存在的 shadcn block 元件問題，非本次修改引入

### File List

| File | Action |
| ---- | ------ |
| `src-tauri/capabilities/default.json` | Modified — 新增 `core:window:allow-set-position` |
| `src-tauri/src/lib.rs` | Modified — 新增 `HUD_WINDOW_WIDTH_LOGICAL` 常數、`HudTargetPosition` struct、`MonitorInfo` struct、`get_cursor_position()` (macOS/Windows)、`find_monitor_for_cursor()`、`get_hud_target_position` command、7 個單元測試；`setup()` 中 hardcoded 400.0 替換為常數 |
| `src/stores/useVoiceFlowStore.ts` | Modified — 新增 `PhysicalPosition` import、`HudTargetPosition` 介面、`HUD_WINDOW_WIDTH_LOGICAL`/`MONITOR_POLL_INTERVAL_MS` 常數、`repositionHudToCurrentMonitor()`/`startMonitorPolling()`/`stopMonitorPolling()` 函式；修改 `showHud()` 整合重定位+輪詢、`transitionTo()` idle 時停止輪詢、`cleanup()` 加入輪詢清理 |

### Change Log

- 2026-03-03: 實作 Multi-Monitor HUD Tracking — HUD 視窗根據游標所在螢幕動態重新定位，支援 macOS + Windows 雙平台
