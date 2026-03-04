---
title: '錄音自動靜音系統喇叭'
slug: 'recording-auto-mute-system-audio'
created: '2026-03-05'
status: 'implementation-complete'
stepsCompleted: [1, 2, 3, 4, 5, 6]
tech_stack: ['Rust CoreAudio (macOS)', 'Rust windows 0.61 WASAPI/EndpointVolume (Windows)', 'Tauri Commands', 'Vue 3 Pinia', 'shadcn-vue Switch', 'tauri-plugin-store']
files_to_modify:
  - 'src-tauri/src/plugins/audio_control.rs (新增)'
  - 'src-tauri/src/plugins/mod.rs'
  - 'src-tauri/src/lib.rs'
  - 'src-tauri/Cargo.toml'
  - 'src-tauri/build.rs'
  - 'src/stores/useVoiceFlowStore.ts'
  - 'src/stores/useSettingsStore.ts'
  - 'src/views/SettingsView.vue'
  - 'CLAUDE.md (IPC 契約表更新)'
code_patterns:
  - 'Rust plugin 架構：一檔一功能於 plugins/，mod.rs 匯出'
  - 'Tauri Command 簽名：<R: Runtime> 泛型約束'
  - 'Settings 持久化：tauri-plugin-store load(STORE_NAME) → get/set/save'
  - 'Settings UI：Card + Switch + useFeedbackMessage() 模式'
  - 'VoiceFlow 狀態：Pinia store，handleStartRecording/handleStopRecording 為主流程'
  - '錯誤路徑：failRecordingFlow() 統一處理錄音流程錯誤'
  - 'Event 封裝：useTauriEvents.ts + emitEvent()'
test_patterns:
  - 'Rust 單元測試：lib.rs 內 #[cfg(test)] mod tests'
  - 'TS 單元測試：tests/unit/*.test.ts (Vitest + jsdom)'
  - 'VoiceFlow 測試：tests/unit/use-voice-flow-store.test.ts'
review_findings_resolved:
  - 'R1-F1: Windows COM 改用 COINIT_APARTMENTTHREADED'
  - 'R1-F2: 補上 AudioObjectPropertyAddress 完整結構體定義'
  - 'R1-F3: 補充 Windows features 驗證說明'
  - 'R1-F4: 分析雙重 restore 路徑，確認冪等設計覆蓋'
  - 'R1-F5: 明確指定 Mutex lock 粒度需貫穿整個操作'
  - 'R1-F6: 不上 App Store，Sandbox entitlement 不適用'
  - 'R1-F7: restore 失敗不通知使用者（僅 log）'
  - 'R1-F8: Switch handler 改為接收參數'
  - 'R1-F9: 補上 SETTINGS_UPDATED payload key'
  - 'R1-F10: 改為直接讀 store ref，不用本地 ref'
  - 'R1-F11-12: 移除行號引用，改用函式名稱定位'
  - 'R1-F13: 明確指定 ref<boolean> 型別'
  - 'R2-adversarial-F1: Windows COM 加 CoUninitialize scope guard（ComGuard）'
  - 'R2-adversarial-F2: restore 失敗時仍清除 state，防止永久靜音'
  - 'R2-adversarial-F8: 預設靜音 ON 維持不動（使用者決策）'
  - 'R2-adversarial-F12: 移除多餘 Arc wrapper（Tauri State 已包 Arc）'
  - 'R3-simplify-Q1: COM guard 移到 get_system_mute/set_system_mute 層級，修正 use-after-uninit'
  - 'R3-simplify-Q2: 移除 S_FALSE dead code 分支（windows-rs 映射為 Ok）'
  - 'R3-simplify-Q4: loadSettings fallback 補上 isMuteOnRecordingEnabled 重設'
  - 'R3-simplify-E1: mute 與 initializeMicrophone 改為 Promise.all 並行'
  - 'R3-simplify-R1: restoreSystemAudio 加 void 前綴統一風格'
  - 'R3-build: build.rs 加入 CoreAudio framework 連結（cargo check 不觸發 linker）'
---

# Tech-Spec: 錄音自動靜音系統喇叭

**Created:** 2026-03-05

## Overview

### Problem Statement

使用者按下錄音快捷鍵時，系統喇叭可能正在播放音樂、通知音或其他聲音，這些聲音會被麥克風收到，干擾錄音品質和語音轉錄的準確度。

### Solution

在錄音開始時，透過 Rust 端原生 API（macOS: CoreAudio, Windows: WASAPI/EndpointVolume）記住當前系統 mute 狀態並靜音，錄音結束後恢復原 mute 狀態。提供 Settings 頁面開關讓使用者控制此行為（預設開啟）。

### Scope

**In Scope:**

- Rust 端新增系統音量控制 plugin（macOS CoreAudio + Windows EndpointVolume）
- 新增 Tauri Commands：`mute_system_audio` / `restore_system_audio`
- `useVoiceFlowStore` 在錄音流程中呼叫靜音/恢復
- Settings 頁面新增「錄音時自動靜音」開關（預設開啟）
- 安全機制：多重恢復路徑 + 冪等設計

**Out of Scope:**

- 麥克風音量/增益控制
- 針對單一應用程式的音量控制（只控制系統主音量）
- Linux 平台支援
- macOS App Store Sandbox entitlement（確認不上 App Store）

## Context for Development

### Codebase Patterns

- **Rust plugin 架構**：每個功能一個檔案於 `src-tauri/src/plugins/`，在 `mod.rs` 匯出
- **Tauri Command 簽名**：必須加泛型 `<R: Runtime>` 約束，返回 `Result<T, CustomError>`
- **錄音流程**：集中在 `useVoiceFlowStore`，透過 `handleStartRecording()` / `handleStopRecording()` 控制
- **錯誤處理**：`failRecordingFlow()` 統一處理錄音流程錯誤——靜音恢復也必須在此路徑觸發
- **Settings 持久化**：`tauri-plugin-store` 的 `load("settings.json")` → `get<T>()` / `set()` / `save()`
- **Settings UI 模式**：`Card` + `Switch` `:model-value` + `@update:model-value` + `useFeedbackMessage()` 回饋
- **macOS 原生呼叫模式**：`extern "C"` 直接宣告 C API（參考 `lib.rs` 的 `CGEventCreate` 用法）
- **Windows 原生呼叫模式**：`windows` crate 的 COM API，需 `unsafe` 區塊

### Files to Modify/Create

| File | Action | Purpose |
| ---- | ------ | ------- |
| `src-tauri/src/plugins/audio_control.rs` | **新增** | 系統音量控制 Rust plugin（macOS CoreAudio + Windows EndpointVolume） |
| `src-tauri/src/plugins/mod.rs` | 修改 | 加入 `pub mod audio_control;` |
| `src-tauri/src/lib.rs` | 修改 | 註冊 commands + 初始化 state |
| `src-tauri/Cargo.toml` | 修改 | Windows: 加 `Win32_Media_Audio`, `Win32_System_Com` features |
| `src-tauri/build.rs` | 修改 | macOS: 連結 `CoreAudio.framework`（`extern "C"` FFI 需手動連結） |
| `src/stores/useVoiceFlowStore.ts` | 修改 | 錄音流程中呼叫 mute/restore |
| `src/stores/useSettingsStore.ts` | 修改 | 新增 `isMuteOnRecordingEnabled` 狀態 |
| `src/views/SettingsView.vue` | 修改 | 新增自動靜音 Switch |

### Files to Reference (Read-Only)

| File | Purpose |
| ---- | ------- |
| `src-tauri/src/plugins/hotkey_listener.rs` | 參考雙平台 plugin 架構（state 管理 + cfg 條件編譯） |
| `src-tauri/src/plugins/keyboard_monitor.rs` | 參考 Tauri command + state 管理模式 |
| `src/composables/useTauriEvents.ts` | Event 常量命名模式 |
| `src/composables/useFeedbackMessage.ts` | Settings 回饋 UI 模式 |

### Technical Decisions

- **只操作 mute flag**：不動音量數值，避免恢復時音量不對
- **冪等 restore**：內部 flag 追蹤是否有 pending restore，多次呼叫安全
- **fire-and-forget 靜音**：mute 失敗不阻擋錄音流程（降級為無靜音模式，僅 log warning）
- **restore 失敗不通知使用者**：僅 log error，不顯示 UI 通知
- **Settings 預設開啟**：`DEFAULT_MUTE_ON_RECORDING = true`
- **Windows COM 線程模型**：使用 `COINIT_APARTMENTTHREADED`（不是 `COINIT_MULTITHREADED`），因為 Tauri 的 Tao 視窗管理可能已在 STA 模式初始化 COM。若已 init 返回 `S_FALSE` 是安全的；若返回 `RPC_E_CHANGED_MODE` 則跳過 init 繼續執行（已在 STA 模式下）
- **Mutex lock 粒度**：`mute_system_audio` 和 `restore_system_audio` 的 Mutex lock 必須貫穿整個「讀取 flag → 呼叫系統 API → 寫入 flag」操作，不可中途釋放再重新取得
- **雙重 restore 路徑分析**：`handleStopRecording()` 開頭呼叫 `restoreSystemAudio()`，後續若 `completePasteFlow()` 失敗走到 `failRecordingFlow()` 會再次呼叫。冪等設計保證第二次 restore 讀到 `was_muted_before = None` 直接跳過，不會出錯

## Implementation Plan

### Tasks

- [x] **Task 1: 修改 Cargo.toml — 新增 Windows audio features**
  - File: `src-tauri/Cargo.toml`
  - Action: 在 `[target.'cfg(target_os = "windows")'.dependencies]` 的 `windows` features 陣列中加入 `"Win32_Media_Audio"` 和 `"Win32_System_Com"`
  - Notes: macOS 不需要新增 crate，使用 `extern "C"` 直接呼叫 CoreAudio C API
  - ⚠️ 實作時驗證：確認 `MMDeviceEnumerator`（CLSID）、`CoCreateInstance`、`CLSCTX_ALL` 是否在這兩個 features 下可用。若不夠，可能還需 `"Win32_System_Com_StructuredStorage"` 或其他 features。編譯時若出現 unresolved import 錯誤，根據錯誤訊息逐一加入缺失 features。

- [x] **Task 2: 新增 audio_control.rs — Rust 音量控制 plugin**
  - File: `src-tauri/src/plugins/audio_control.rs`（新增）
  - Action: 實作雙平台系統音量 mute/restore
  - 結構（實際實作移除了多餘 Arc，Tauri State 已自帶 Arc）：
    ```rust
    pub struct AudioControlState {
        was_muted_before: Mutex<Option<bool>>,  // None = 沒有 pending restore
    }
    ```
  - **⚠️ Mutex lock 粒度規則**：`mute` 和 `restore` 操作中，Mutex lock 必須持有到整個「讀 flag → 呼叫系統 API → 寫 flag」序列完成。不可在讀取後釋放鎖再重新取得，否則並發 command 會造成競爭條件。
  - **⚠️ restore 先清 state**：`restore_system_audio` 先將 `was_muted_before` 清為 `None`，再呼叫 platform API 恢復。確保即使恢復失敗，下次錄音仍可正常 mute/restore，不會永久卡住。
  - macOS 實作（`#[cfg(target_os = "macos")]`）：
    - 完整結構體定義：
      ```rust
      #[repr(C)]
      struct AudioObjectPropertyAddress {
          mSelector: u32,
          mScope: u32,
          mElement: u32,
      }
      ```
    - `get_default_output_device() -> Option<u32>` — 組裝 `AudioObjectPropertyAddress { mSelector: kAudioHardwarePropertyDefaultOutputDevice, mScope: kAudioObjectPropertyScopeGlobal, mElement: kAudioObjectPropertyElementMain }` 並呼叫 `AudioObjectGetPropertyData(kAudioObjectSystemObject, ...)`
    - `get_device_mute(device_id: u32) -> Result<bool>` — 組裝 `AudioObjectPropertyAddress { mSelector: kAudioDevicePropertyMute, mScope: kAudioObjectPropertyScopeOutput, mElement: kAudioObjectPropertyElementMain }` 並讀取
    - `set_device_mute(device_id: u32, muted: bool) -> Result<()>` — 同上 address，呼叫 `AudioObjectSetPropertyData`
    - 使用 `extern "C"` 宣告 `AudioObjectGetPropertyData` / `AudioObjectSetPropertyData`
  - Windows 實作（`#[cfg(target_os = "windows")]`）：
    - `init_com() -> Result<ComGuard>` — COM 初始化 + scope guard（ComGuard 在 Drop 時自動 CoUninitialize）
    - `get_default_endpoint_volume() -> Result<IAudioEndpointVolume>` — 純取得介面（不含 COM init）
    - `get_system_mute() -> Result<bool>` — `init_com()` + `get_default_endpoint_volume()` + `GetMute()`
    - `set_system_mute(muted: bool) -> Result<()>` — `init_com()` + `get_default_endpoint_volume()` + `SetMute()`
    - **⚠️ COM guard 必須活到操作完成**：`ComGuard` 放在 public function（`get_system_mute`/`set_system_mute`）層級，確保 COM apartment 在使用 COM interface 期間保持有效。不可將 guard 放在 `get_default_endpoint_volume` 內，否則 guard drop 後 COM interface 會失效（use-after-uninit）
    - **COM 初始化處理**：使用 `COINIT_APARTMENTTHREADED`。`windows-rs` 將 `S_OK` 和 `S_FALSE` 都映射為 `Ok(())`（需配對 CoUninitialize）；`RPC_E_CHANGED_MODE`（0x80010106）映射為 `Err`，跳過 init 繼續操作（不需 CoUninitialize）
  - Tauri Commands：
    - `mute_system_audio(state: State<AudioControlState>) -> Result<(), String>` — 在 lock 內：讀 flag → 若 None 則取系統 mute 狀態 → 設為 mute → 寫入 flag
    - `restore_system_audio(state: State<AudioControlState>) -> Result<(), String>` — 在 lock 內：讀 flag → 若 Some(was_muted) 則先清除 flag 為 None → 再恢復系統 mute 狀態（先清後恢復，確保失敗不卡住）
  - 冪等邏輯：
    - `mute`: 若 `was_muted_before` 已有值（pending restore），跳過（已經靜音了）
    - `restore`: 若 `was_muted_before` 為 `None`，跳過（沒有 pending restore）

- [x] **Task 3: 註冊 audio_control module**
  - File: `src-tauri/src/plugins/mod.rs`
  - Action: 在現有 3 行後加入 `pub mod audio_control;`

- [x] **Task 4: 註冊 Tauri Commands 和 State**
  - File: `src-tauri/src/lib.rs`
  - Action:
    - 在 `.invoke_handler(tauri::generate_handler![...])` 中加入 `plugins::audio_control::mute_system_audio` 和 `plugins::audio_control::restore_system_audio`
    - 在 `.setup()` 內加入 `app.manage(plugins::audio_control::AudioControlState::new());`

- [x] **Task 5: useSettingsStore 新增靜音設定**
  - File: `src/stores/useSettingsStore.ts`
  - Action:
    - 新增 `export const DEFAULT_MUTE_ON_RECORDING = true;`
    - 新增 `const isMuteOnRecordingEnabled = ref<boolean>(DEFAULT_MUTE_ON_RECORDING);`（型別明確為 `ref<boolean>`，與 `isAutoStartEnabled` 模式一致）
    - `loadSettings()` 中加入讀取：`const savedMuteOnRecording = await store.get<boolean>("muteOnRecording"); isMuteOnRecordingEnabled.value = savedMuteOnRecording ?? DEFAULT_MUTE_ON_RECORDING;`
    - 新增方法：
      ```typescript
      async function saveMuteOnRecording(enabled: boolean) {
        try {
          const store = await load(STORE_NAME);
          await store.set("muteOnRecording", enabled);
          await store.save();
          isMuteOnRecordingEnabled.value = enabled;

          const payload: SettingsUpdatedPayload = {
            key: "muteOnRecording",
            value: enabled,
          };
          await emitEvent(SETTINGS_UPDATED, payload);
          console.log(`[useSettingsStore] muteOnRecording saved: ${enabled}`);
        } catch (err) {
          console.error("[useSettingsStore] saveMuteOnRecording failed:", extractErrorMessage(err));
          throw err;
        }
      }
      ```
    - 在 return 中匯出 `isMuteOnRecordingEnabled` 和 `saveMuteOnRecording`

- [x] **Task 6: useVoiceFlowStore 整合靜音流程**
  - File: `src/stores/useVoiceFlowStore.ts`
  - Action:
    - 新增 helper：
      ```typescript
      async function muteSystemAudioIfEnabled() {
        const settingsStore = useSettingsStore();
        if (!settingsStore.isMuteOnRecordingEnabled) return;
        try {
          await invoke("mute_system_audio");
        } catch (err) {
          writeErrorLog(`useVoiceFlowStore: mute_system_audio failed (non-blocking): ${extractErrorMessage(err)}`);
        }
      }

      function restoreSystemAudio() {
        void invoke("restore_system_audio").catch((err) =>
          writeErrorLog(`useVoiceFlowStore: restore_system_audio failed: ${extractErrorMessage(err)}`)
        );
      }
      ```
    - `handleStartRecording()`：`await Promise.all([muteSystemAudioIfEnabled(), initializeMicrophone()])` — 兩者並行（互不依賴：mute 操作系統喇叭輸出，mic init 操作麥克風輸入）
    - `handleStopRecording()`：在函式最開頭（`stopElapsedTimer()` 之前）呼叫 `restoreSystemAudio()`（fire-and-forget，確保不論後續流程成功或失敗都恢復）
    - `failRecordingFlow()`：在函式開頭加入 `restoreSystemAudio()`
  - **⚠️ 雙重 restore 路徑**：`handleStopRecording` 開頭 restore → 後續 `completePasteFlow` 的 catch 呼叫 `failRecordingFlow` 再次 restore。這是刻意設計：冪等的 `restore_system_audio` 第二次呼叫時讀到 `was_muted_before = None` 直接跳過。
  - Notes:
    - `muteSystemAudioIfEnabled()` 是 async 但與 `initializeMicrophone()` 並行（Promise.all），失敗不阻擋錄音
    - `restoreSystemAudio()` 是 fire-and-forget（不 await），不影響後續流程
    - `handleStopRecording` 開頭恢復是因為：不論後續轉錄/整理/貼上是否成功，喇叭都應該恢復

- [x] **Task 7: SettingsView 新增自動靜音開關**
  - File: `src/views/SettingsView.vue`
  - Action:
    - 在 `<script setup>` 新增：
      - `const muteOnRecordingFeedback = useFeedbackMessage();`
      - handler（直接讀 store ref，不建本地 ref，與 `isAutoStartEnabled` 模式一致）：
        ```typescript
        async function handleToggleMuteOnRecording(newValue: boolean) {
          try {
            await settingsStore.saveMuteOnRecording(newValue);
            muteOnRecordingFeedback.show("success", newValue ? "已啟用錄音自動靜音" : "已停用錄音自動靜音");
          } catch (err) {
            muteOnRecordingFeedback.show("error", extractErrorMessage(err));
          }
        }
        ```
      - `onBeforeUnmount` 中加入：`muteOnRecordingFeedback.clearTimer();`
    - 在 template 的「應用程式」Card（`<CardContent>` 內），在 auto-start 區塊**之前**插入：
      ```html
      <div class="flex items-center justify-between">
        <div>
          <Label for="mute-on-recording">錄音時自動靜音</Label>
          <p class="text-sm text-muted-foreground">開始錄音時自動靜音系統喇叭，結束後恢復</p>
        </div>
        <Switch
          id="mute-on-recording"
          :model-value="settingsStore.isMuteOnRecordingEnabled"
          @update:model-value="handleToggleMuteOnRecording"
        />
      </div>
      <div class="border-t border-border" />
      ```
    - feedback transition 同 auto-start 模式

### Acceptance Criteria

- [x] **AC 1**: Given 使用者啟用「錄音時自動靜音」設定（預設開啟），when 按下錄音快捷鍵開始錄音，then 系統喇叭被靜音（mute）
- [x] **AC 2**: Given 錄音正在進行中且系統已被靜音，when 錄音結束（放開快捷鍵），then 系統 mute 狀態恢復到錄音前的原始狀態
- [x] **AC 3**: Given 錄音過程中發生錯誤（如麥克風失敗），when 錄音流程進入錯誤狀態，then 系統 mute 狀態仍然被恢復
- [x] **AC 4**: Given 使用者在 Settings 停用「錄音時自動靜音」，when 按下錄音快捷鍵，then 系統喇叭不被靜音
- [x] **AC 5**: Given 系統喇叭在錄音前已經是 mute 狀態，when 錄音開始和結束，then 系統仍維持 mute 狀態（不會意外 unmute）
- [x] **AC 6**: Given 靜音 API 呼叫失敗（如權限問題），when 錄音開始，then 錄音流程不被阻擋，僅 log warning
- [x] **AC 7**: Given Settings 頁面開啟，when 切換「錄音時自動靜音」開關，then 設定被持久化並顯示回饋訊息
- [x] **AC 8**: Given macOS 環境，when 執行靜音/恢復操作，then 透過 CoreAudio API 正確控制預設輸出裝置 mute 狀態
- [x] **AC 9**: Given Windows 環境，when 執行靜音/恢復操作，then 透過 WASAPI/EndpointVolume 正確控制系統音量 mute 狀態

## Additional Context

### Dependencies

**Cargo.toml 變更：**
- Windows `windows` crate 需新增 features：`"Win32_Media_Audio"`, `"Win32_System_Com"`
- macOS 不需要新增 crate（使用 `extern "C"` 直接呼叫 CoreAudio C API），但需在 `build.rs` 加入 `println!("cargo:rustc-link-lib=framework=CoreAudio")` 連結 framework
- ⚠️ `cargo check` 不觸發 linker，只有 `cargo build` / `pnpm tauri dev` 才會出現 linker 錯誤
- ⚠️ 實作時若 import 報錯，可能還需 `"Win32_System_Com_StructuredStorage"` 等額外 features

**macOS CoreAudio API：**
```rust
use std::ffi::c_void;

/// CoreAudio property address — 必須 repr(C) 確保記憶體對齊正確
#[repr(C)]
struct AudioObjectPropertyAddress {
    mSelector: u32,
    mScope: u32,
    mElement: u32,
}

extern "C" {
    fn AudioObjectGetPropertyData(
        inObjectID: u32,
        inAddress: *const AudioObjectPropertyAddress,
        inQualifierDataSize: u32,
        inQualifierData: *const c_void,
        ioDataSize: *mut u32,
        outData: *mut c_void,
    ) -> i32;  // OSStatus, 0 = noErr

    fn AudioObjectSetPropertyData(
        inObjectID: u32,
        inAddress: *const AudioObjectPropertyAddress,
        inQualifierDataSize: u32,
        inQualifierData: *const c_void,
        inDataSize: u32,
        inData: *const c_void,
    ) -> i32;  // OSStatus, 0 = noErr
}

// FourCC 常數（big-endian byte order）
const kAudioHardwarePropertyDefaultOutputDevice: u32 = 0x644F7574; // 'dOut'
const kAudioDevicePropertyMute: u32 = 0x6D757465;                  // 'mute'
const kAudioObjectPropertyScopeOutput: u32 = 0x6F757470;           // 'outp'
const kAudioObjectPropertyScopeGlobal: u32 = 0x676C6F62;           // 'glob'
const kAudioObjectPropertyElementMain: u32 = 0;
const kAudioObjectSystemObject: u32 = 1;
```

**Windows WASAPI API：**
```rust
use windows::Win32::Media::Audio::{
    eRender, eConsole,
    IMMDeviceEnumerator, MMDeviceEnumerator,
    IAudioEndpointVolume,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoUninitialize,
    CLSCTX_ALL, COINIT_APARTMENTTHREADED,  // ⚠️ 不是 COINIT_MULTITHREADED
};
use windows::core::Interface;

// COM 初始化處理（windows-rs HRESULT 映射規則）：
// - S_OK (0) → Ok(()): 成功初始化，需配對 CoUninitialize
// - S_FALSE (1) → Ok(()): 已在同模式下初始化，仍需配對 CoUninitialize
// - RPC_E_CHANGED_MODE (0x80010106) → Err: 已在不同模式，跳過（不需 CoUninitialize）
// ⚠️ ComGuard scope guard 必須存活到 COM interface 操作完成
```

### Testing Strategy

**Rust 單元測試（`audio_control.rs` 內 `#[cfg(test)]`）：**
- `test_audio_control_state_new` — 初始化時 `was_muted_before` 為 `None`
- `test_mute_idempotent` — 連續呼叫 mute 不 panic（第二次跳過）
- `test_restore_without_mute` — 沒有先 mute 就 restore 不 panic（跳過）
- `test_state_reset_after_restore` — restore 後 state 回到 `None`

**注意**：平台 API 呼叫（CoreAudio/WASAPI）是真實系統呼叫，無法在 CI 中 mock。Rust 測試聚焦在 state 管理邏輯。

**手動測試步驟：**
1. macOS: 播放音樂 → 按錄音快捷鍵 → 確認音樂靜音 → 放開 → 確認音樂恢復
2. Windows: 同上流程
3. 錄音前已 mute → 錄音開始/結束 → 確認仍為 mute
4. Settings 關閉自動靜音 → 錄音 → 確認音樂不被靜音
5. 錄音中故意觸發錯誤（如拔麥克風）→ 確認音量恢復

### Notes

**高風險項目：**
- macOS CoreAudio `AudioObjectPropertyAddress` 結構的 `repr(C)` 對齊必須正確，否則 UB — 完整結構定義已在 Dependencies 區段提供
- Windows COM 初始化使用 `COINIT_APARTMENTTHREADED`，處理 `RPC_E_CHANGED_MODE` 回傳值。`ComGuard` scope guard 確保配對 `CoUninitialize`
- `IAudioEndpointVolume` 是 COM 介面，`windows` crate 的 `Interface` trait 會自動管理 `Release()`
- Windows COM guard 必須放在 public function 層級（`get_system_mute`/`set_system_mute`），不可放在 `get_default_endpoint_volume` 內（否則 guard drop 後 COM interface 失效）
- macOS `extern "C"` FFI 需在 `build.rs` 手動連結 `CoreAudio.framework`（`cargo check` 不會報錯，只有 `cargo build` 的 linker 階段才會暴露）
- Mutex lock 必須貫穿完整 read→syscall→write 序列，防止並發 command 競爭

**已知限制：**
- 只控制預設輸出裝置；如使用者切換輸出裝置（如插入耳機），mute 的是舊裝置
- macOS 某些 USB/藍牙音訊裝置可能不支援 mute 屬性（會在 CoreAudio 層回傳錯誤碼）
- restore 失敗時僅 log，不通知使用者（使用者需手動取消靜音）

**未來考慮（Out of Scope）：**
- 支援 per-app 音量控制（macOS: Audio Middleware, Windows: `ISimpleAudioVolume`）
- 監聽音訊裝置切換事件（`kAudioHardwarePropertyDefaultOutputDevice` property listener）
