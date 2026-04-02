---
title: '麥克風選擇器改進：預設裝置名稱顯示 + 音量預覽條'
slug: 'mic-selector-enhancement'
created: '2026-03-27 10:50:12'
status: 'completed'
stepsCompleted: [1, 2, 3, 4]
tech_stack: ['Tauri v2', 'Vue 3 (Composition API)', 'Rust', 'cpal 0.15', 'shadcn-vue (new-york)', 'lucide-vue-next', '@vueuse/core']
files_to_modify:
  - 'src-tauri/src/plugins/audio_recorder.rs'
  - 'src-tauri/src/lib.rs'
  - 'src/views/SettingsView.vue'
  - 'src/composables/useTauriEvents.ts'
  - 'src/types/audio.ts'
  - 'src/i18n/locales/zh-TW.json'
  - 'src/i18n/locales/en.json'
  - 'src/i18n/locales/zh-CN.json'
  - 'src/i18n/locales/ja.json'
  - 'src/i18n/locales/ko.json'
files_to_create:
  - 'src/composables/useAudioPreview.ts'
code_patterns:
  - 'Tauri command: #[command] fn → invoke_handler 註冊 → invoke<T>() 呼叫'
  - 'State: pub struct → app.manage() → State<T> 注入'
  - 'Event: emit(name, payload) → listenToEvent(name, callback)'
  - 'Composable: useX() → ref + lifecycle + onUnmounted cleanup'
  - 'LERP animation: useRafFn + lerp(current, target, speed)'
  - 'Device selection: device_name.is_empty() → default_input_device()'
  - 'Shutdown: state.shutdown() in RunEvent::Exit handler'
test_patterns:
  - 'Rust: #[cfg(test)] mod tests in same file'
  - 'Frontend: tests/unit/*.test.ts with vitest'
adversarial_review: 'completed — 12 findings, 11 addressed (F12 noise)'
---

# Tech-Spec: 麥克風選擇器改進：預設裝置名稱顯示 + 音量預覽條

**Created:** 2026-03-27 10:50:12

## Overview

### Problem Statement

使用者在設定頁面選擇麥克風時，「系統預設」選項不顯示實際對應的裝置名稱，無法判斷目前使用的是內建麥克風還是藍牙耳機。此外，選擇麥克風後沒有即時回饋，無法確認選中的麥克風是否有在收音。這導致 GitHub #18、#19 等使用者回報「未偵測到語音」的問題。

### Solution

1. 在「系統預設」選項後方括號標示實際使用的裝置名稱（如「系統預設（MacBook Pro的麥克風）」）
2. 在麥克風下拉選單下方顯示即時音量條，讓使用者確認選中裝置有在收音

### Scope

**In Scope:**
- 系統預設選項顯示實際裝置名稱
- 當前選中裝置的即時音量預覽條（單一 RMS level bar）
- 設定頁開啟時自動啟動預覽、離開時停止
- 切換裝置時重新啟動預覽
- 錄音進行中自動停止預覽（避免衝突）

**Out of Scope:**
- 全裝置同時音量監測
- 下拉選單內每個選項的音量條
- 音量調整功能
- 分段錄音/音訊壓縮（另案處理）

## Context for Development

### Codebase Patterns

#### Rust 端架構

- **裝置列舉** — `audio_recorder.rs:123-141` `list_audio_input_devices()`: 用 `cpal::default_host().input_devices()` 迭代所有輸入裝置，回傳 `Vec<AudioInputDeviceInfo { name }>`
- **預設裝置** — `audio_recorder.rs:287-320`: `host.default_input_device()` 取得預設，`.name().ok()` 取名稱
- **裝置選擇** — `device_name.is_empty()` → 用預設；否則先比對預設名稱，不符再 `input_devices().find()`
- **輸入格式** — `audio_recorder.rs:382-424` `determine_input_config()`: 優先 16kHz mono，不支援則 fallback 到裝置預設。此函式為 `fn`（非 pub），preview code 放在同檔案內可直接使用
- **Stream 建立** — `audio_recorder.rs:426-556` `build_input_stream()` → `build_typed_input_stream<T>()`: 泛型處理所有 sample format，callback 內做 mono mix + FFT waveform emit
- **cpal macOS Arc cycle workaround** — `audio_recorder.rs:281-319`: 優先使用 `default_input_device()` 路徑避免 Arc cycle；stream 結束時必須 `stream.pause()` before drop（L370-378）。**preview thread 必須遵循相同 workaround**
- **State 模式** — `AudioRecorderState { recording: Mutex<Option<RecordingHandle>> }` + `shutdown()` method
- **Graceful shutdown** — `lib.rs:518-564` `RunEvent::Exit` handler 依序 shutdown 各 state

#### 前端架構

- **SettingsView 麥克風 UI** — `SettingsView.vue:1306-1358`: shadcn-vue `Select` + `_default` 特殊值 + `RefreshCw` 按鈕
- **裝置列表載入** — `SettingsView.vue:639-646` `loadAudioInputDeviceList()`: `invoke<AudioInputDeviceInfo[]>("list_audio_input_devices")`
- **生命週期** — `onMounted:681` 呼叫 `loadAudioInputDeviceList()`；`onBeforeUnmount:704` 清理 timers
- **Waveform composable** — `useAudioWaveform.ts`: `useRafFn` + LERP(0.25) + `listenToEvent(AUDIO_WAVEFORM)`，6 bar 動畫
- **事件常量** — `useTauriEvents.ts:19` `AUDIO_WAVEFORM = "audio:waveform"`
- **型別** — `audio.ts`: `AudioInputDeviceInfo { name }`, `WaveformPayload { levels: number[] }`

### Files to Reference

| File | Purpose | Key Lines |
| ---- | ------- | --------- |
| `src-tauri/src/plugins/audio_recorder.rs` | 裝置列舉、錄音、waveform | L118-141, L274-380, L382-424, L426-556 |
| `src-tauri/src/lib.rs` | command/state 註冊、shutdown | L413-442, L444-451, L518-564 |
| `src/views/SettingsView.vue` | 設定 UI | L639-679, L681-702, L704-720, L1306-1358 |
| `src/composables/useAudioWaveform.ts` | LERP 動畫參考 | 完整檔案 |
| `src/composables/useTauriEvents.ts` | 事件常量 | L19 |
| `src/types/audio.ts` | TS 型別 | L1-13 |
| `src/i18n/locales/zh-TW.json` | 繁中翻譯 | L124-130 audioInput section |

### Technical Decisions

1. **預設裝置名稱用獨立 command** — 新增 `get_default_input_device_name` 而非改 `AudioInputDeviceInfo`，因為預設裝置可能隨時改變，需要獨立查詢
2. **音量預覽獨立 state** — `AudioPreviewState` 與 `AudioRecorderState` 完全隔離，避免預覽干擾錄音
3. **RMS 而非 FFT** — 預覽只需單一音量值，不需 6-bar 頻譜，計算更輕量
4. **Rust 端自動停止** — `start_recording` 呼叫時自動 stop preview，不需跨視窗協調
5. **30ms emit 間隔** — 比錄音的 16ms 稍寬鬆，約 33fps，足以呈現流暢音量變化且不會在 RAF 幀間產生可見延遲
6. **preview code 在 `audio_recorder.rs` 同檔案** — 直接使用 `determine_input_config`、`build_typed_input_stream` 等 private fn，無需改可見性或新建 module
7. **preview stream 不儲存 samples** — 只在 callback 中計算 RMS 並 emit，不累積記憶體
8. **preview startup 需 ready 同步** — 使用 `mpsc::channel` 回報 stream 建立成功/失敗，避免與 `start_recording` 的 race condition
9. **dB 對數映射** — RMS → dB（-60 to -20 dB range），AirPods Pro 等低增益麥克風的語音才有足夠的視覺反饋
10. **共用 `select_input_device` helper** — recording/preview thread 共用裝置選擇邏輯（含 cpal Arc cycle workaround）
11. **`PreviewHandle` 含 JoinHandle** — `stop_audio_preview_inner` 會 join thread，確保裝置完全釋放後再開始錄音
12. **前端 re-entrancy guard** — `useAudioPreview` 用 `startRequestId` 防止快速切換裝置時的 listener 洩漏
13. **start_recording 鎖定順序** — 先取 recording lock 再停 preview，消除 TOCTOU race window

## Implementation Plan

### Tasks

- [x] Task 1: 新增 `get_default_input_device_name` Rust command
  - File: `src-tauri/src/plugins/audio_recorder.rs`
  - Action: 在 `list_audio_input_devices` command 後新增：
    ```rust
    #[command]
    pub fn get_default_input_device_name() -> Option<String> {
        let host = cpal::default_host();
        let result = host.default_input_device().and_then(|d| {
            d.name().map_err(|e| {
                eprintln!("[audio-recorder] Failed to get default device name: {}", e);
                e
            }).ok()
        });
        println!("[audio-recorder] Default input device: {:?}", result);
        result
    }
    ```
  - Notes: `device.name()` 的 `Err` 會 log 後轉為 `None`，前端無法區分「無裝置」vs「讀名稱失敗」但兩者 UI 行為一致（fallback 顯示「系統預設」）

- [x] Task 2: 新增 `AudioPreviewState` + preview commands
  - File: `src-tauri/src/plugins/audio_recorder.rs`
  - Action:
    1. 新增 payload：
       ```rust
       #[derive(Clone, serde::Serialize)]
       pub struct AudioPreviewLevelPayload {
           level: f32,
       }
       ```
    2. 新增 state：
       ```rust
       pub struct AudioPreviewState {
           should_stop: Mutex<Option<Arc<AtomicBool>>>,
       }
       impl AudioPreviewState {
           pub fn new() -> Self { Self { should_stop: Mutex::new(None) } }
           pub fn shutdown(&self) {
               if let Ok(guard) = self.should_stop.lock() {
                   if let Some(flag) = guard.as_ref() {
                       flag.store(true, Ordering::SeqCst);
                   }
               }
           }
       }
       ```
    3. 新增 `start_audio_preview(app, preview_state, device_name)` command：
       - 先呼叫 `stop_audio_preview_inner` 停止舊 preview
       - Spawn `run_preview_thread`
       - 用 `mpsc::channel` 等待 stream ready signal（成功回 `Ok(())`，失敗回 `Err`）
       - 回傳 `Result<(), String>`
    4. 新增 `stop_audio_preview(state)` command
    5. 新增 `fn stop_audio_preview_inner(state: &AudioPreviewState)` 私有 helper

- [x] Task 3: 實作 `run_preview_thread`
  - File: `src-tauri/src/plugins/audio_recorder.rs`
  - Action: 新增私有函式 `fn run_preview_thread(app: AppHandle, should_stop: Arc<AtomicBool>, device_name: String, ready_tx: mpsc::Sender<Result<(), String>>)`
    1. **裝置選擇**：與 `run_recording_thread` L287-320 相同邏輯：
       - `device_name.is_empty()` → `host.default_input_device()`
       - 否則先比對預設名稱，符合用 `default_input_device()`（macOS Arc cycle workaround）
       - 不符再 `input_devices().find()`，找不到 fallback 到預設
    2. **輸入格式**：呼叫 `determine_input_config(&device)`
    3. **Stream 建立**：用與 `build_input_stream` 相同的 sample format match，但 callback 更簡單：
       - Mono mix（與現有相同）
       - 累積 `sum_squares` 和 `sample_count`（用 `Arc<Mutex<(f64, usize)>>` 或 `AtomicU64`）
       - 不存 samples、不做 FFT
    4. **Ready signal**：stream 建立成功後 `ready_tx.send(Ok(()))`，失敗 `ready_tx.send(Err(...))`
    5. **主迴圈**：每 30ms：
       - 讀取累積的 `sum_squares` / `sample_count`
       - 計算 RMS：`sqrt(sum_squares / count)` → clamp(0.0, 1.0)
       - 重置累積值
       - `app.emit("audio:preview-level", AudioPreviewLevelPayload { level: rms })`
       - 檢查 `should_stop`
    6. **清理**：`stream.pause()` → drop stream（遵循 cpal macOS workaround L370-378）

- [x] Task 4: `start_recording` 自動停止 preview
  - File: `src-tauri/src/plugins/audio_recorder.rs`
  - Action: 在 `start_recording` command 開頭（`guard.is_some()` 檢查前），加入：
    ```rust
    // 停止音量預覽，避免兩個 stream 衝突
    if let Some(preview_state) = app.try_state::<AudioPreviewState>() {
        stop_audio_preview_inner(&preview_state);
        // 等待 preview thread 結束
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    ```
  - Notes: 用 `app.try_state` 而非 `State<T>` 參數注入，避免改動 `start_recording` 的函式簽名。加 100ms sleep 確保 preview stream 完全釋放裝置

- [x] Task 5: 註冊 commands + state + shutdown
  - File: `src-tauri/src/lib.rs`
  - Action:
    1. `invoke_handler`（L413-442）新增：
       ```
       plugins::audio_recorder::get_default_input_device_name,
       plugins::audio_recorder::start_audio_preview,
       plugins::audio_recorder::stop_audio_preview,
       ```
    2. `setup`（L444-451）新增：`app.manage(plugins::audio_recorder::AudioPreviewState::new());`
    3. `RunEvent::Exit` — **preview shutdown 必須在 recorder shutdown 之前**（避免兩者同時釋放裝置）：
       ```rust
       // 2.5 停止音量預覽（在 cpal 錄音之前）
       if let Some(state) = app_handle.try_state::<plugins::audio_recorder::AudioPreviewState>() {
           state.shutdown();
       }
       // 2. 停止 cpal 錄音（join thread, drop AudioUnit）
       if let Some(state) = app_handle.try_state::<plugins::audio_recorder::AudioRecorderState>() {
           state.shutdown();
       }
       ```

- [x] Task 6: 新增前端事件常量 + 型別
  - File: `src/composables/useTauriEvents.ts`
  - Action: 新增 `export const AUDIO_PREVIEW_LEVEL = "audio:preview-level" as const;`
  - File: `src/types/audio.ts`
  - Action: 新增 `export interface AudioPreviewLevelPayload { level: number; }`

- [x] Task 7: 建立 `useAudioPreview.ts` composable
  - File: `src/composables/useAudioPreview.ts`（新建）
  - Action: 參考 `useAudioWaveform.ts` 的模式，建立：
    ```typescript
    import { ref, onUnmounted } from "vue";
    import { useRafFn } from "@vueuse/core";
    import type { UnlistenFn } from "@tauri-apps/api/event";
    import { invoke } from "@tauri-apps/api/core";
    import { listenToEvent, AUDIO_PREVIEW_LEVEL } from "./useTauriEvents";
    import type { AudioPreviewLevelPayload } from "../types/audio";

    const LERP_SPEED = 0.2;

    function lerp(current: number, target: number, speed: number): number {
      return current + (target - current) * speed;
    }

    export function useAudioPreview() {
      const previewLevel = ref(0);
      const isPreviewActive = ref(false);
      let targetLevel = 0;
      let unlistenPreview: UnlistenFn | null = null;

      const { pause, resume } = useRafFn(() => {
        previewLevel.value = lerp(previewLevel.value, targetLevel, LERP_SPEED);
      }, { immediate: false });

      async function startPreview(deviceName: string): Promise<void> {
        await stopPreview();
        try {
          await invoke("start_audio_preview", { deviceName });
          unlistenPreview = await listenToEvent<AudioPreviewLevelPayload>(
            AUDIO_PREVIEW_LEVEL,
            (event) => { targetLevel = event.payload.level; },
          );
          isPreviewActive.value = true;
          resume();
        } catch (err) {
          console.error("[useAudioPreview] start failed:", err);
        }
      }

      async function stopPreview(): Promise<void> {
        isPreviewActive.value = false;
        pause();
        targetLevel = 0;
        previewLevel.value = 0;
        if (unlistenPreview) {
          unlistenPreview();
          unlistenPreview = null;
        }
        try {
          await invoke("stop_audio_preview");
        } catch { /* ignore — preview may not be running */ }
      }

      onUnmounted(() => { void stopPreview(); });

      return { previewLevel, isPreviewActive, startPreview, stopPreview };
    }
    ```
  - Notes: LERP speed 0.2（介於 waveform 0.25 和更平滑的 0.15 之間，經驗證在 30ms emit 間隔下視覺流暢）

- [x] Task 8: 新增 i18n `systemDefaultWithDevice` key
  - Files: 5 個 locale JSON
  - Action: 在 `settings.audioInput` section 內，`systemDefault` key 後新增：
    | Locale | Key | Value |
    |--------|-----|-------|
    | zh-TW | `systemDefaultWithDevice` | `系統預設（{device}）` |
    | en | `systemDefaultWithDevice` | `System Default ({device})` |
    | zh-CN | `systemDefaultWithDevice` | `系统默认（{device}）` |
    | ja | `systemDefaultWithDevice` | `システムデフォルト（{device}）` |
    | ko | `systemDefaultWithDevice` | `시스템 기본값 ({device})` |
  - Notes: placeholder 名稱統一用 `{device}`；長裝置名稱由 SelectTrigger 自動 truncate（shadcn-vue Select 內建 `overflow-hidden text-ellipsis`）

- [x] Task 9: 更新 `SettingsView.vue` — 預設裝置名稱 + 音量條
  - File: `src/views/SettingsView.vue`
  - Action:
    1. **Import**: 新增 `import { useAudioPreview } from "../composables/useAudioPreview";`、`Mic` from `lucide-vue-next`
    2. **Script 變數**:
       - `const defaultInputDeviceName = ref<string | null>(null);`
       - `const { previewLevel, isPreviewActive, startPreview, stopPreview } = useAudioPreview();`
    3. **`loadAudioInputDeviceList()`** 同時呼叫：
       ```typescript
       defaultInputDeviceName.value = await invoke<string | null>("get_default_input_device_name");
       ```
    4. **`handleRefreshAudioInputDeviceList()`** 同上，刷新預設名稱 + restart preview
    5. **`handleAudioInputDeviceChange()`** 成功後 restart preview：
       ```typescript
       void startPreview(deviceName);
       ```
    6. **`onMounted`** 新增：`void startPreview(settingsStore.selectedAudioInputDeviceName);`
    7. **`onBeforeUnmount`** 新增：`void stopPreview();`
    8. **Template `_default` SelectItem**（L1326-1328）改為：
       ```vue
       <SelectItem value="_default">
         {{ defaultInputDeviceName
           ? $t("settings.audioInput.systemDefaultWithDevice", { device: defaultInputDeviceName })
           : $t("settings.audioInput.systemDefault")
         }}
       </SelectItem>
       ```
    9. **Template 音量條**（L1346 `</div>` 後、L1348 `<transition>` 前）新增：
       ```vue
       <div
         v-if="isPreviewActive"
         role="meter"
         :aria-valuenow="Math.round(previewLevel * 100)"
         aria-valuemin="0"
         aria-valuemax="100"
         :aria-label="$t('settings.audioInput.volumePreview')"
         class="flex items-center gap-2 h-5"
       >
         <Mic class="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
         <div class="flex-1 h-1.5 rounded-full bg-secondary overflow-hidden">
           <div
             class="h-full rounded-full bg-primary transition-[width] duration-75"
             :style="{ width: `${Math.round(previewLevel * 100)}%` }"
           />
         </div>
       </div>
       ```
  - Notes: 音量條加 `role="meter"` + `aria-valuenow` + `aria-label` 確保無障礙。需在 i18n 中新增 `volumePreview` key（如「麥克風音量預覽」）

### Acceptance Criteria

- [x] AC 1: Given 設定頁已開啟且系統有預設輸入裝置, when 使用者查看麥克風下拉選單, then 第一個選項顯示「系統預設（{裝置名稱}）」
- [x] AC 2: Given 系統無預設輸入裝置或 `device.name()` 失敗, when 使用者查看麥克風下拉選單, then 第一個選項顯示「系統預設」（無括號）
- [x] AC 3: Given 設定頁已開啟且選中裝置有收音, when 使用者對麥克風說話, then 音量條寬度隨音量即時變化（0%-100%）
- [x] AC 4: Given 設定頁已開啟且選中裝置無收音, when 環境安靜, then 音量條寬度接近 0%
- [x] AC 5: Given 使用者切換輸入裝置, when 選擇新裝置, then 音量條重新啟動並反映新裝置的音量
- [x] AC 6: Given 設定頁已開啟且音量預覽正在執行, when 使用者按 hotkey 開始錄音, then 音量預覽自動停止，錄音正常進行
- [x] AC 7: Given 使用者離開設定頁, when 頁面 unmount, then 音量預覽停止，macOS 麥克風指示燈熄滅
- [x] AC 8: Given 使用者按刷新按鈕, when 裝置列表重新載入, then 預設裝置名稱更新 + 音量預覽重新啟動
- [x] AC 9: Given macOS 環境, when 音量預覽執行中, then 不影響 HUD 視窗的錄音功能（兩者獨立）
- [x] AC 10: Given app 退出, when `RunEvent::Exit` 觸發, then `AudioPreviewState` 在 `AudioRecorderState` 之前 shutdown，不殘留 thread
- [x] AC 11: Given 錄音正在進行中, when 使用者開啟設定頁, then 不啟動音量預覽（避免衝突）

## Additional Context

### Dependencies

- 無新 crate 依賴（cpal 已存在；preview 不需 rustfft）
- 前端無新依賴（`@vueuse/core` 已有 `useRafFn`）
- 依賴 Task 1-5（Rust 端）完成後才能測試 Task 6-9（前端）

### Testing Strategy

**Rust 測試（cargo test）：**
- `AudioPreviewState::new()` + `shutdown()` 不 panic
- `AudioPreviewState` 重複 `shutdown()` 不 panic（double-shutdown safety）
- `AudioPreviewState` `should_stop` flag 正確傳播

**前端測試（pnpm test）：**
- 現有測試回歸通過（349+ tests）
- i18n smoke test 覆蓋新 key（`systemDefaultWithDevice`, `volumePreview`）

**手動測試：**
1. 開啟設定頁 → 確認「系統預設（裝置名稱）」正確顯示
2. 對麥克風說話 → 音量條有反應
3. 切換到其他裝置 → 音量條跟著切換
4. 按 hotkey 錄音 → 音量條停止，錄音正常
5. 錄音中開啟設定頁 → 音量條不啟動
6. 離開設定頁 → macOS 麥克風指示燈熄滅
7. 接/拔藍牙耳機 → 按刷新，預設名稱更新
8. App 退出 → 無殘留 thread

### Notes

- **cpal Arc cycle**：preview stream 必須遵循 `audio_recorder.rs:281-319` workaround — 優先 `default_input_device()` 路徑，stream 結束時 `stream.pause()` before drop
- **macOS 麥克風指示燈**：preview 開啟時會亮，這是預期行為（使用者在測試麥克風）
- **preview code 位置**：所有 preview 相關 code 放在 `audio_recorder.rs` 同檔案，直接使用 `determine_input_config` 等 private fn，不新建 module
- **i18n 額外 key**：除 `systemDefaultWithDevice` 外，需新增 `volumePreview` key（5 個 locale）用於 aria-label
- **未來考量**：可在音量條旁加「裝置名稱」標籤，或加 dB 數值顯示，但目前 out of scope

## Review Notes

- Adversarial review completed: 15 findings total
- 12 fixed, 2 kept as-is (pattern-consistent with existing codebase), 1 noise skipped
- Resolution approach: auto-fix
- Key fixes: TOCTOU race elimination, thread join for clean shutdown, atomic RMS accumulator, dB perceptual scaling, re-entrancy guard
- Commit: `cd46210`
