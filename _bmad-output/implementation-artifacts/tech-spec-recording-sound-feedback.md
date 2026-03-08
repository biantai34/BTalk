---
title: '錄音操作音效回饋'
slug: 'recording-sound-feedback'
created: '2026-03-08'
status: 'ready-for-dev'
stepsCompleted: [1, 2, 3, 4]
tech_stack: ['Rust (AudioServicesPlaySystemSound / Win32 PlaySound)', 'Tauri Command', 'macOS AudioToolbox', 'Win32 PlaySound']
files_to_modify: ['src-tauri/src/plugins/sound_feedback.rs', 'src-tauri/src/plugins/mod.rs', 'src-tauri/src/lib.rs', 'src/stores/useVoiceFlowStore.ts', 'src-tauri/Cargo.toml', 'src-tauri/resources/sounds/start.wav', 'src-tauri/resources/sounds/stop.wav', 'CLAUDE.md']
code_patterns: ['cfg(target_os) 條件編譯', 'mod macos / mod windows 平台分離', 'Tauri Command 註冊在 lib.rs invoke_handler', 'plugins/mod.rs 註冊新模組']
test_patterns: ['Rust #[cfg(test)] mod tests 在同檔案底部', 'Vitest + jsdom 前端測試']
---

# Tech-Spec: 錄音操作音效回饋

**Created:** 2026-03-08

## Overview

### Problem Statement

使用者按下快捷鍵開始/結束錄音時缺乏聽覺回饋，無法直覺感知操作是否生效。

### Solution

在開始錄音和結束錄音時播放系統音效（macOS `NSSound` / Windows `PlaySound`），音效播放不受「錄音靜音」功能影響，固定開啟不可關閉。

### Scope

**In Scope:**
- 開始錄音時播放一個系統音效
- 結束錄音時播放另一個系統音效
- macOS + Windows 雙平台支援
- 音效不受 `mute_system_audio` 影響

**Out of Scope:**
- 使用者自訂音效檔案
- 音效開關設定
- 其他狀態（轉錄完成、錯誤等）的音效

## Context for Development

### Codebase Patterns

- 錄音流程由 `useVoiceFlowStore.ts` 的 `handleStartRecording()` / `handleStopRecording()` 驅動
- 系統靜音功能在 `plugins/audio_control.rs`，透過 `mute_system_audio` / `restore_system_audio` command 控制
- 靜音機制：macOS CoreAudio `AudioObjectSetPropertyData(kAudioDevicePropertyMute)` / Windows WASAPI `IAudioEndpointVolume::SetMute`
- 平台特定邏輯使用 `#[cfg(target_os = "...")]` + 各平台子模組（`mod macos` / `mod windows_audio`）
- plugin 檔案在 `src-tauri/src/plugins/` 下，需在 `mod.rs` 註冊
- Tauri command 在 `lib.rs` 的 `tauri::generate_handler![]` 巨集註冊
- State 在 `lib.rs` 的 `.setup()` 中用 `app.manage()` 初始化

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `src/stores/useVoiceFlowStore.ts` | 錄音流程主控 store（音效呼叫插入點） |
| `src-tauri/src/plugins/audio_control.rs` | 系統音量控制（靜音/還原），參考平台分離模式 |
| `src-tauri/src/plugins/audio_recorder.rs` | 音訊錄製 plugin |
| `src-tauri/src/plugins/mod.rs` | plugin 模組註冊 |
| `src-tauri/src/lib.rs` | Tauri command 註冊 + State 初始化 |
| `tests/unit/use-voice-flow-store.test.ts` | VoiceFlow store 前端測試 |

### Technical Decisions

- **音效選擇**：macOS 使用 `Funk`（開始）+ `Bottle`（結束），Windows 使用自訂 WAV 檔案 `dm/Windows Hardware Insert`（開始）+ `dm/Windows Hardware Remove`（結束），透過 `include_bytes!` 嵌入 binary
- **播放 API**：macOS `AudioServicesPlaySystemSound`（AudioToolbox framework，不依賴 RunLoop），Windows `PlaySoundA`（Win32 API）+ `SND_MEMORY` 從記憶體播放嵌入的 WAV 資料
- **為什麼不用 NSSound**：`NSSound.play()` 依賴 RunLoop 驅動播放事件，Tauri `#[command]` 跑在 tokio worker thread 上沒有 RunLoop，會導致音效不播放。`AudioServicesPlaySystemSound` 不依賴 RunLoop，適合背景執行緒呼叫
- 音效播放在 Rust 端執行，不經由前端
- 音效固定開啟，無使用者設定
- **靜音繞過策略**：調整時序確保音效播放時系統未靜音
  - 開始錄音：fire-and-forget `play_start_sound` + `setTimeout` 400ms 延遲靜音同時排定 → await `start_recording`
  - `delayedMuteTimer` 管理：在 `handleStopRecording`、`failRecordingFlow`、`cleanup` 中 `clearTimeout`，防止錄音結束後 stale timer 觸發靜音
  - 結束錄音：await `restoreSystemAudio` → fire-and-forget `play_stop_sound`
- **非阻塞播放**：macOS `AudioServicesPlaySystemSound` 立即回傳、不阻塞，Windows `PlaySound` 用 `SND_ASYNC`
- 新增 `src-tauri/src/plugins/sound_feedback.rs` 作為獨立 plugin
- **objc FFI 參考**：`clipboard_paste.rs` 中的 `msg_send!` 模式為 macOS FFI 範例參考
- **前端直接 invoke**：不建立封裝函式，直接 `invoke("play_start_sound")` / `invoke("play_stop_sound")`，與現有 store 慣例一致

## Implementation Plan

### Tasks

- [ ] Task 1: 建立 `sound_feedback.rs` plugin — macOS 實作
  - File: `src-tauri/src/plugins/sound_feedback.rs`
  - Action: 建立新檔案，實作 macOS 平台音效播放
  - Notes:
    - 建立 `mod macos` 子模組，使用 AudioToolbox framework 的 `AudioServicesPlaySystemSound`
    - 不使用 `NSSound`（因為它依賴 RunLoop，tokio worker thread 上不播放）
    - 透過 `extern "C"` FFI 宣告 `AudioServicesCreateSystemSoundID` 和 `AudioServicesPlaySystemSound`
    - 音效檔案路徑：`/System/Library/Sounds/Funk.aiff`（開始）、`/System/Library/Sounds/Bottle.aiff`（結束）
    - 需要建立 `CFURLRef`（透過 `core_foundation` crate 的 `CFURL::from_path`）指向音效檔案
    - 流程：`CFURL::from_path()` → `AudioServicesCreateSystemSoundID()` → `AudioServicesPlaySystemSound()`
    - `AudioServicesPlaySystemSound` 立即回傳、不阻塞、不依賴 RunLoop
    - 提供 `play_start_sound()` 和 `play_stop_sound()` 兩個公開函式
    - `AudioServicesCreateSystemSoundID` 失敗時回傳非零 OSStatus，需檢查並 `eprintln!` 記錄
    - 音效播放失敗時靜默處理，不應影響錄音流程
    - 參考 `clipboard_paste.rs` 的 macOS FFI 模式

- [ ] Task 2: 建立 `sound_feedback.rs` plugin — Windows 實作
  - File: `src-tauri/src/plugins/sound_feedback.rs`
  - Action: 在同檔案內建立 `mod windows_sound` 子模組
  - Notes:
    - 使用 `windows::Win32::Media::PlaySoundA` + `SND_MEMORY | SND_ASYNC` 從記憶體播放嵌入的 WAV 資料
    - WAV 檔案透過 `include_bytes!("../../resources/sounds/start.wav")` 和 `stop.wav` 在編譯時嵌入
    - 音效來源：Windows 11 dm 主題的 `Windows Hardware Insert.wav`（開始）和 `Windows Hardware Remove.wav`（結束），選用冷門音效避免與系統常見音效混淆
    - `PlaySoundA` 第一個參數為 `PCSTR(bytes.as_ptr())`，指向記憶體中的 WAV 資料
    - `PlaySoundA` 回傳 `Result`，失敗時 `eprintln!` 記錄
    - 與 macOS 相同的錯誤處理策略（靜默失敗）
    - 不使用 `SND_ALIAS` + 系統別名，因為使用者可能自訂系統音效，且常見別名易與系統功能混淆

- [ ] Task 3: 建立平台無關包裝函式 + Tauri Commands
  - File: `src-tauri/src/plugins/sound_feedback.rs`
  - Action: 建立 `platform_play_start_sound()` / `platform_play_stop_sound()` 包裝函式，並建立對應的 Tauri `#[command]`
  - Notes:
    - 使用 `#[cfg(target_os = "...")]` 條件編譯分派到各平台實作
    - `#[cfg(not(any(...)))]` fallback 為 no-op（`println!` 記錄後回傳）
    - Tauri commands 確切簽名為 `#[command] pub fn play_start_sound()` 和 `#[command] pub fn play_stop_sound()`，無參數，回傳 `()`（不使用 `Result`）
    - Commands 不需要 State，純函式呼叫
    - 平台函式內部的錯誤已靜默處理，command 層級不需要再 catch

- [ ] Task 4: 註冊新 plugin 模組
  - File: `src-tauri/src/plugins/mod.rs`
  - Action: 新增 `pub mod sound_feedback;`

- [ ] Task 5: 註冊 Tauri commands
  - File: `src-tauri/src/lib.rs`
  - Action: 在 `tauri::generate_handler![]` 巨集中新增 `plugins::sound_feedback::play_start_sound` 和 `plugins::sound_feedback::play_stop_sound`

- [ ] Task 6: 新增 Windows `Win32_Media` feature
  - File: `src-tauri/Cargo.toml`
  - Action: 在 `[target.'cfg(target_os = "windows")'.dependencies]` 的 windows features 中新增 `"Win32_Media"`
  - Notes: `PlaySoundW` 位於 `windows::Win32::Media`，需要此 feature

- [ ] Task 7: 修改前端錄音流程 — 開始錄音加入音效
  - File: `src/stores/useVoiceFlowStore.ts`
  - Action: 修改 `handleStartRecording()` 函式
  - Notes:
    - 修改後完整流程（在既有 try block 內部）：
      1. `void invoke("play_start_sound").catch(() => {})` — fire-and-forget 播放開始音效，catch 靜默處理失敗
      2. `await invoke("start_recording")` — 同時啟動錄音（與音效同步開始）
      3. `startElapsedTimer()` + `transitionTo("recording")` — 原有邏輯不變
      4. `delayedMuteTimer = setTimeout(() => { void muteSystemAudioIfEnabled() }, START_SOUND_DURATION_MS)` — 延遲 400ms 後靜音，在音效主要可感知段播完後靜音
    - 400ms 為 Funk 音效 attack + sustain 段的可感知長度（全長 2.16s 但後段為低音量 decay），抽取為 `const START_SOUND_DURATION_MS = 400`，放在檔案頂部常數區
    - `setTimeout` 必須在 `await invoke("start_recording")` 之前排定，確保 timer 與音效同時起跑，不受 IPC 耗時影響
    - `delayedMuteTimer` 必須在 `handleStopRecording`、`failRecordingFlow`、`cleanup` 中 `clearTimeout`，防止錄音結束後 stale timer 誤觸靜音
    - 音效用 fire-and-forget（不需 await），因為音效與錄音同時啟動，不存在時序依賴
    - 音效失敗（`.catch(() => {})`）不影響後續流程，靜默吞掉錯誤
    - 音效播放初期的少量聲音可能被麥克風錄進去，但 Whisper 能正確辨識為背景音，對 UX 影響極小

- [ ] Task 8: 修改前端錄音流程 — 結束錄音加入音效
  - File: `src/stores/useVoiceFlowStore.ts`
  - Action: 修改 `handleStopRecording()` 函式
  - Notes:
    - **重要**：現有 `restoreSystemAudio()` 是 fire-and-forget（`void invoke(...)`），不等待結果。必須改為 await 確保音量已還原
    - 將 `restoreSystemAudio()` 改為 async 函式，內部 `await invoke("restore_system_audio")`，失敗仍靜默處理
    - 修改後完整流程：
      1. `await restoreSystemAudio()` — 確保系統音量已還原
      2. `void invoke("play_stop_sound").catch(() => {})` — fire-and-forget 播放結束音效（此時系統已非靜音）
      3. 繼續原有的 `transitionTo("transcribing")` 及後續流程
    - 結束音效用 fire-and-forget 即可（不需 await），因為後續流程不依賴音效完成
    - 音效呼叫失敗不影響轉錄流程

- [ ] Task 9: 更新前端測試
  - File: `tests/unit/use-voice-flow-store.test.ts`
  - Action: 為新增的 `play_start_sound` / `play_stop_sound` invoke 呼叫加入 mock
  - Notes:
    - 在現有的 `vi.mock` 中加入對 `play_start_sound` 和 `play_stop_sound` 的 mock
    - 驗證開始錄音時 `play_start_sound` 被呼叫
    - 驗證結束錄音時 `play_stop_sound` 被呼叫

- [ ] Task 10: 更新 CLAUDE.md IPC 契約表
  - File: `CLAUDE.md`
  - Action: 在「Tauri Commands（Frontend → Rust）」表格中新增兩個 command
  - Notes:
    - `play_start_sound` | `plugins/sound_feedback.rs` | useVoiceFlowStore | — | `()`
    - `play_stop_sound` | `plugins/sound_feedback.rs` | useVoiceFlowStore | — | `()`

### Acceptance Criteria

- [ ] AC 1: Given 使用者按下快捷鍵開始錄音，when 錄音流程啟動，then 播放開始音效（macOS: Funk, Windows: dm/Hardware Insert）
- [ ] AC 2: Given 使用者釋放快捷鍵結束錄音，when 錄音停止且系統音量還原後，then 播放結束音效（macOS: Bottle, Windows: dm/Hardware Remove）
- [ ] AC 3: Given 「錄音時靜音」功能已啟用，when 開始錄音，then 音效在靜音前播放，使用者能聽到音效
- [ ] AC 4: Given 「錄音時靜音」功能未啟用，when 開始錄音，then 音效正常播放
- [ ] AC 5: Given 系統音效播放失敗（如音效檔不存在），when 開始/結束錄音，then 錄音流程不受影響，正常繼續
- [ ] AC 6: Given Windows 平台，when 開始/結束錄音，then 播放對應的 Windows 系統音效
- [ ] AC 7: Given 使用 toggle 模式，when 連續按兩次快捷鍵（開始→結束），then 分別聽到開始音效和結束音效

## Additional Context

### Dependencies

- **macOS**: `core-foundation` crate 0.10（已存在於 `Cargo.toml`）— 用於 `CFURL` 建構。`AudioServicesPlaySystemSound` / `AudioServicesCreateSystemSoundID` 透過 `extern "C"` FFI 直接宣告（AudioToolbox framework 已被 Tauri 連結，不需額外 crate）
- **Windows**: `windows` crate 0.61（已存在）— 需 `Win32_Media` feature 用於 `PlaySoundA`。WAV 檔案透過 `include_bytes!` 嵌入，無需 runtime 資源路徑解析
- 無新增外部 crate 依賴

### Testing Strategy

**Rust 端：**
- `sound_feedback.rs` 底部加入 `#[cfg(test)] mod tests`
- 測試包裝函式存在且可呼叫（平台相關的實際播放無法在 CI 測試）
- 非支援平台的 no-op fallback 測試

**前端：**
- 更新 `use-voice-flow-store.test.ts`，mock `play_start_sound` / `play_stop_sound` invoke
- 驗證 `handleStartRecording` 呼叫 `play_start_sound`
- 驗證 `handleStopRecording` 呼叫 `play_stop_sound`
- 驗證音效呼叫失敗不影響主流程

**手動測試：**
- macOS: 確認聽到 Funk（開始）+ Bottle（結束）
- 開啟「錄音時靜音」：確認開始音效在靜音前可聽到
- 關閉「錄音時靜音」：確認兩個音效都完整播放
- 確認音效不會被 Whisper 轉錄為文字（正常狀況下因為音效短暫，不影響）

### Notes

- **音效被錄進去的風險**：音效與錄音同時啟動，前 ~400ms 音效仍在播放中（靜音前）。由於系統音效走 output device、錄音走 input device（麥克風），除非使用者用外放喇叭+近距離麥克風，否則不會被錄進去。即使被錄到，Whisper 能正確辨識為背景音而非語音，對轉錄結果影響極小。
- **Windows 音效選擇**：使用 Windows 11 dm 主題的 `Windows Hardware Insert.wav` / `Windows Hardware Remove.wav`，透過 `include_bytes!` 嵌入 binary + `PlaySoundA` `SND_MEMORY` 播放。選用冷門主題音效避免與系統常見功能（通知、錯誤等）混淆。WAV 檔案存放於 `src-tauri/resources/sounds/`（start.wav / stop.wav），合計 ~200KB。
- **未來擴展**：若需支援自訂音效或音效開關，建議在 `useSettingsStore` 新增設定項，並將音效名稱作為 Tauri command 參數傳入。
- **400ms 延遲靜音**：`START_SOUND_DURATION_MS = 400` 為 Funk 音效 attack + sustain 段的可感知長度。Funk 全長 ~2.16s 但後段為低音量 decay/release，人耳不敏感。400ms 在音效主要段播完後即靜音，兼顧聽覺回饋與快速靜音。`setTimeout` 必須在 `await invoke("start_recording")` 之前排定，否則 IPC 耗時會疊加導致延遲過長。
- **restoreSystemAudio 改為 async**：此修改影響既有的 `handleStopRecording` 流程，從 fire-and-forget 改為 await。這是為了確保系統音量在播放結束音效前已恢復。對現有功能無副作用（原本失敗也是靜默處理）。

### Adversarial Review 修正摘要

| Finding | 修正方式 |
|---------|---------|
| F1 (Critical): restoreSystemAudio race condition | Task 8: 改為 await restoreSystemAudio 後再播放 stop sound |
| F9 (Medium): NSSound RunLoop 依賴 | Task 1: 改用 AudioServicesPlaySystemSound |
| F3 (High): fire-and-forget + sleep 時序不準 | Task 7: 改為 fire-and-forget 音效 + setTimeout 400ms 延遲靜音（在 await 之前排定）+ delayedMuteTimer 管理防止 stale timer |
| F4 (High): 修改後流程不具體 | Task 7/8: 補上完整步驟流程 |
| F2 (High): sleep 實作方式未指定 | Task 7: 指定 inline Promise + setTimeout |
| F6 (Medium): NSSound nil check | Task 1: 改用 AudioServices，回傳 OSStatus 檢查 |
| F8 (Medium): command 簽名歧義 | Task 3: 明確 `pub fn play_start_sound()` 回傳 `()` |
| F10 (Medium): Windows 寬字串 | Task 2: 補上 `w!()` 巨集說明 |
| F12 (Low): 缺少 FFI 參考 | Technical Decisions: 補上參考 clipboard_paste.rs |
| F13 (Low): 未更新 IPC 契約表 | Task 10: 新增更新 CLAUDE.md |
| F5 (Medium): Win32_Media feature | Task 6: 保持不變，實作時驗證 |
| F7 (Medium): 是否需封裝函式 | Technical Decisions: 明確不需要 |
| F11 (Low): 150ms 無依據 | Notes: 補上說明為經驗值 |
