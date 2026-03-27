---
title: '組合鍵 + Double-tap 模式切換 + 選取文字編輯'
slug: 'multi-hotkey-system'
created: '2026-03-27'
status: 'phase1-implemented'
stepsCompleted: [1, 2, 3, 4]
tech_stack: ['Tauri v2', 'Vue 3 Composition API', 'Rust', 'CGEventTap (macOS)', 'SetWindowsHookExW (Windows)', 'tauri-plugin-store', 'shadcn-vue', 'Pinia', 'Vitest', 'core-graphics 0.24', 'core-foundation 0.10', 'windows 0.61']
files_to_modify:
  - src-tauri/src/plugins/hotkey_listener.rs
  - src-tauri/src/lib.rs
  - src/types/settings.ts
  - src/types/events.ts
  - src/composables/useTauriEvents.ts
  - src/stores/useSettingsStore.ts
  - src/stores/useVoiceFlowStore.ts
  - src/components/NotchHud.vue
  - src/App.vue
  - src/views/SettingsView.vue
  - src/lib/keycodeMap.ts
  - src/i18n/locales/zh-TW.json
  - src/i18n/locales/en.json
  - src/i18n/locales/ja.json
  - src/i18n/locales/zh-CN.json
  - src/i18n/locales/ko.json
  - src-tauri/src/plugins/text_field_reader.rs
  - src/i18n/prompts.ts
  - tests/unit/settingsStore.test.ts
code_patterns:
  - 'TriggerKey serde tagged enum (Rust camelCase ↔ TS string union)'
  - 'Settings persist chain: store.set() → store.save() → invoke() → emitEvent(SETTINGS_UPDATED)'
  - 'CGEventTap FlagsChanged flag-based detection for modifiers, KeyDown/KeyUp for non-modifiers'
  - 'Event naming: {domain}:{action} kebab-case'
  - 'Plugin State shutdown convention: pub fn shutdown(&self)'
  - 'Architecture.md designed combo key: { modifiers: Vec<Modifier>, keycode: u16 }'
  - 'Two-tier hotkey UI: preset Select + custom Record (from tech-spec-custom-hotkey)'
  - 'VoiceFlow abort pattern: isAborted + AbortController + abort guards after every await'
  - 'Minimum recording duration: 300ms (MINIMUM_RECORDING_DURATION_MS)'
test_patterns:
  - 'Vitest unit tests in tests/unit/'
  - 'vi.mock for tauri plugin-http fetch and invoke'
  - 'Priority tags: [P0] [P1] in test names'
  - 'Rust #[cfg(test)] mod tests in same file'
reviewed: true
review_findings_addressed: 28
---

# Tech-Spec: 組合鍵 + Double-tap 模式切換 + 選取文字編輯

**Created:** 2026-03-27

## Overview

### Problem Statement

目前 SayIt 的自訂快捷鍵只支援單鍵，使用者無法用組合鍵（如 ⌘+J）避免誤觸。切換語音整理模式（精簡/積極）必須進設定頁面，無法在工作流中快速切換。此外，選取文字後無法用語音指令進行改寫/翻譯。（GitHub Issues #12、#20）

### Solution

三個功能擴展：
1. **自訂組合鍵**：錄鍵時支援「修飾鍵 + 主鍵」組合（如 ⌘+J），預設單鍵不變
2. **Double-tap 切模式**：Hold 模式下快速按兩下觸發鍵，在精簡 ↔ 積極之間切換，HUD 閃現新模式名稱
3. **選取文字編輯**（Phase 2）：偵測到選取文字時自動進入語音指令模式

### Scope

**In Scope:**

- 自訂快捷鍵支援組合鍵（修飾鍵 + 主鍵）
- Double-tap 切模式（Hold 模式限定，單鍵和組合鍵都支援，minimal ↔ active，持久化）
- HUD 錄音時顯示 prompt mode badge（精簡/積極/自訂）+ double-tap 閃現
- 選取文字編輯（Phase 2，macOS only）
- Rust 雙平台（macOS CGEventTap + Windows hook）
- i18n 5 語言

**Out of Scope:**

- 多組快捷鍵 Slot（不需要，double-tap 切模式已足夠）
- Windows 選取文字編輯（UI Automation 未實作）
- 語音串流 (streaming) 回應

## Context for Development

### Codebase Patterns

1. **TriggerKey serde 鏡像**：Rust `TriggerKey` enum（含 `Custom { keycode }`）與 TS `TriggerKey` 型別完全鏡像，`#[serde(rename_all = "camelCase")]`。自訂組合鍵擴展此 enum。

2. **Settings 持久化鏈路**：UI → `useSettingsStore.saveXxx()` → `tauri-plugin-store` → `invoke("update_hotkey_config")` 同步 Rust → `emitEvent(SETTINGS_UPDATED)` 廣播。

3. **CGEventTap callback**：單一閉包處理 FlagsChanged/KeyDown/KeyUp。修飾鍵用 `CGEventFlags` 偵測，非修飾鍵用 keycode toggle。Fn 鍵有雙重策略。

4. **Architecture.md 組合鍵設計**（第 89-93 行）：`{ modifiers: Vec<Modifier>, keycode }`，macOS 用 CGEventFlags，Windows 用 GetKeyState。向後相容：舊 `{ keycode }` = `{ modifiers: [], keycode }`。

5. **HUD 通訊**：NotchHud 接收 App.vue 的 props（從 useVoiceFlowStore 讀取），不直接監聽 Tauri events。新增 prop 即可。

6. **Plugin State shutdown**：必須實作 `shutdown(&self)`，處理 Mutex poisoned。

7. **ESC 為保留鍵**：走獨立路徑 emit `escape:pressed`，不可用於觸發鍵或組合鍵主鍵。

8. **全域 promptMode**：現有 `useSettingsStore.promptMode` ref，`getAiPrompt()` 據此回傳 prompt。double-tap 只需切換此 ref 並持久化。

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `src-tauri/src/plugins/hotkey_listener.rs` | Rust 快捷鍵核心（State、CGEventTap、Windows hook、handle_key_event） |
| `src-tauri/src/lib.rs` | Tauri command 註冊、shutdown 順序 |
| `src/types/settings.ts` | TriggerKey/HotkeyConfig/PromptMode 型別 |
| `src/types/events.ts` | HotkeyEventPayload 事件型別 |
| `src/composables/useTauriEvents.ts` | 事件常量 + listen/emit 封裝 |
| `src/stores/useSettingsStore.ts` | hotkeyConfig/promptMode 持久化 |
| `src/stores/useVoiceFlowStore.ts` | 錄音生命週期、事件監聽、enhancer 呼叫 |
| `src/components/NotchHud.vue` | HUD VisualMode、NotchShape |
| `src/App.vue` | HUD 視窗入口，傳 props 給 NotchHud |
| `src/views/SettingsView.vue` | 快捷鍵設定 UI（preset/custom、Hold/Toggle） |
| `src/lib/keycodeMap.ts` | DOM code ↔ platform keycode 映射 |
| `src/i18n/prompts.ts` | prompt templates × 5 語言 |
| `src-tauri/src/plugins/text_field_reader.rs` | macOS AX API 文字讀取 |
| `_bmad-output/project-context.md` | 276 條實作規則（必讀） |

### Technical Decisions

- **擴展現有 `TriggerKey` 而非新增 `SlotTrigger`**：在 Rust `TriggerKey` enum 新增 `Combo { modifiers, keycode }` variant，與現有 `Custom { keycode }` 並列。前端 TS 同步擴展。Serde 格式為 **externally tagged**（Rust serde 預設，enum 無 `#[serde(tag)]` 標註）。JSON 範例：`{ "combo": { "modifiers": ["command"], "keycode": 38 } }`。**注意**：enum-level `#[serde(rename_all = "camelCase")]` 只影響 variant key（如 `"rightOption"`），不傳播到 struct variant 內部欄位。`Combo` 的 `modifiers` 和 `keycode` 已是小寫不需 rename，但未來若加多字詞欄位需在 variant 內部另加 `#[serde(rename_all)]`
- **維持單一快捷鍵架構**：不引入 Slot/SlotId，保持現有 `hotkeyConfig: { triggerKey, triggerMode }` 結構不變。`promptMode` 維持全域設定
- **組合鍵 release = 任一鍵放開停止**：使用者不會刻意控制放鍵順序
- **Double-tap 偵測在 Rust 層**：追蹤主鍵 press/release timing。單鍵追蹤整個鍵，組合鍵追蹤主鍵（修飾鍵保持按住）。條件：Hold 模式 + 主鍵 hold < 300ms + 間隔 < 350ms
- **Toggle 模式長按切模式**：Toggle 模式改為 release-based。長按 ≥ 1s → spawn thread 偵測，1s 後 `is_pressed` 仍 true 則 emit `hotkey:mode-toggle`（HUD 立即出現）。Release 時 `toggle_long_press_fired` = true 則跳過 toggle。短按 < 1s → 正常 toggle（start/stop）
- **Double-tap 循環 minimal ↔ active**：不含 custom。切換結果持久化
- **前端用 Promise-based `waitForDoubleTapResolution` 處理競態**：`handleStopRecording` 在 `estimatedDurationMs < 350` 時 `await` 一個 Promise，等 mode-toggle event 到達（resolve true）或 400ms 超時（resolve false）。mode-toggle 確認後呼叫 `applyDoubleTapModeSwitch()` 取消錄音並切模式。Toggle 模式長按時 `handleDoubleTapModeToggle` 直接呼叫 `applyDoubleTapModeSwitch()`
- **Combo 不需衝突偵測**：preset 和 custom/combo 是二選一——切到 preset 模式後 combo 設定保留但不生效，與現有 custom 單鍵行為一致
- **`hotkey:mode-toggle` 直接 emit `()`**：不需專用 payload struct，與現有 `escape:pressed` 模式一致
- **`mode-switch` 只存在於 NotchHud 的 `VisualMode`**：不進 `HudStatus`（store 層），由 `modeSwitchLabel` prop 驅動。顯示 3 秒後 store 清空 label 並呼叫 `transitionTo("idle")` 觸發 collapse 動畫（與 success 流程一致）
- **ESC 中斷同時清除 DoubleTapState**
- **HUD badge 顯示所有模式**：精簡、積極、自訂都顯示對應標籤
- **單一 Mutex `HotkeySharedState`**：合併 active_modifiers + double_tap_state + recording_state，與現有 trigger_key Mutex 合併，避免多鎖 deadlock
- **Rust-driven 錄鍵**：錄製快捷鍵完全由 Rust CGEventTap/Windows hook 處理（`start_hotkey_recording` / `cancel_hotkey_recording` commands + `hotkey:recording-captured` / `hotkey:recording-rejected` events），不依賴 DOM `KeyboardEvent`。解決 Fn 鍵不產生 DOM 事件 + 修飾鍵單獨按被阻擋的問題
- **`ModifierFlag::Fn`**：macOS 用 `CGEventFlagSecondaryFn` 偵測。Fn 在 recording mode 用 toggle-based（keycode 63）偵測 press/release。支援 Fn 單鍵（Custom）和 Fn+J 組合鍵（Combo）。Windows 無 Fn（firmware 層）
- **組合鍵 exact modifier match**：`matches_combo_trigger` 檢查 `modifiers.len() == active_mods.len()`，⌘+J 不會被 ⌘+⇧+J 觸發

## Implementation Plan

### Phase 1: 組合鍵 + Double-tap + HUD

- [x] Task 1: Rust 型別擴展 — TriggerKey 新增 Combo variant
  - File: `src-tauri/src/plugins/hotkey_listener.rs`
  - Action:
    - 新增 `ModifierFlag` enum（Command, Control, Option, Shift）— `#[serde(rename_all = "camelCase")]`
    - 在 `TriggerKey` enum 新增 variant：`Combo { modifiers: Vec<ModifierFlag>, keycode: u16 }`
  - Notes: 現有 `Custom { keycode }` 保留不動。Serde 為 externally tagged（預設），JSON：`{ "combo": { "modifiers": [...], "keycode": N } }`。不需 `ModTogglePayload` struct——`hotkey:mode-toggle` 直接 emit `()`

- [x] Task 2: TypeScript 型別擴展
  - File: `src/types/settings.ts`
  - Action:
    - 新增 `ModifierFlag = "command" | "control" | "option" | "shift"`
    - 新增 `ComboTriggerKey = { combo: { modifiers: ModifierFlag[]; keycode: number } }`
    - 擴展 `TriggerKey = PresetTriggerKey | CustomTriggerKey | ComboTriggerKey`
    - 新增 type guard `isComboTriggerKey(key: TriggerKey): key is ComboTriggerKey`
  - File: `src/composables/useTauriEvents.ts`
  - Action: 新增 `HOTKEY_MODE_TOGGLE = "hotkey:mode-toggle" as const`

- [x] Task 3: Rust State 重構 — 合併 Mutex + 新增 double-tap 和 modifier 追蹤
  - File: `src-tauri/src/plugins/hotkey_listener.rs`
  - Action:
    - 新增 `HotkeySharedState { trigger_key: TriggerKey, trigger_mode: TriggerMode, active_modifiers: HashSet<ModifierFlag>, double_tap: DoubleTapState }`
    - 新增 `DoubleTapState { last_release_time: Option<Instant>, last_hold_start: Option<Instant> }`
    - 重構 `HotkeyListenerState`：用 `shared: Arc<Mutex<HotkeySharedState>>` 取代 `trigger_key` + `trigger_mode` 兩個獨立 Mutex
    - `update_config(key, mode)`：lock `shared` 更新 trigger_key + trigger_mode + 清除 double_tap + reset AtomicBool
    - `reset_key_states()`：重置 `is_pressed` + `is_toggled_on` + lock `shared` 清除 `DoubleTapState`
    - `shutdown()`：處理 `shared` Mutex poisoned

- [x] Task 4: Rust 組合鍵比對邏輯
  - File: `src-tauri/src/plugins/hotkey_listener.rs`
  - Action:
    - 新增 `update_active_modifiers(flags: CGEventFlags) -> HashSet<ModifierFlag>`：從 CGEventFlags 提取當前按住的修飾鍵
    - 擴展 `matches_trigger_key_macos(keycode, trigger_key)`：新增 `TriggerKey::Combo` 分支 → 不在此比對（組合鍵需要在 callback 中同時檢查 modifier + keycode）
    - 新增 `matches_combo_trigger(keycode, combo, active_mods) -> bool`：`combo.modifiers ⊆ active_mods && keycode == combo.keycode`
  - Notes: 組合鍵的修飾鍵透過 `active_modifiers`（從 FlagsChanged 更新）檢查，主鍵透過 KeyDown/KeyUp 檢查

- [x] Task 5: Rust double-tap 偵測邏輯
  - File: `src-tauri/src/plugins/hotkey_listener.rs`
  - Action:
    - 新增 `check_double_tap(shared: &HotkeySharedState) -> bool`：
      - 前置：`shared.trigger_mode == Hold` → Toggle 模式直接 return false
      - 檢查 `double_tap.last_release_time` 距今 < 350ms 且上次 hold < 300ms → true
    - 新增 `record_release_for_double_tap(shared: &mut HotkeySharedState, hold_start: Instant)`：hold > 300ms → 清除 last_release_time，否則記錄
    - 在 `handle_key_event` pressed=true 分支：先 `check_double_tap`，true → emit `"hotkey:mode-toggle"` + `()`，**不** emit `hotkey:pressed`
    - 在 `handle_key_event` pressed=false 分支：`record_release_for_double_tap`
  - Notes: 組合鍵的 double-tap 追蹤**主鍵**的 timing（使用者按住 ⌘ 快速點兩下 J）

- [x] Task 6: 重構 macOS CGEventTap callback 支援組合鍵
  - File: `src-tauri/src/plugins/hotkey_listener.rs`
  - Action: 修改 `start_event_tap` 閉包：
    - 一次 lock `shared` → 取 trigger_key + trigger_mode + update active_modifiers + 讀 double_tap → 釋放
    - FlagsChanged：更新 `active_modifiers`。如果 trigger 是 Combo 且修飾鍵消失 → 觸發 release（任一鍵放開 = 停止）。現有單鍵 modifier 邏輯保留
    - KeyDown：ESC 不變。如果 trigger 是 Combo → `matches_combo_trigger` 比對。如果 trigger 是 Single/Custom → 現有邏輯
    - KeyUp：Combo 的主鍵放開 → 觸發 release。Single/Custom → 現有邏輯
    - Fn 鍵特殊雙重策略保留
  - Notes: callback 只 lock `shared` 一次

- [x] Task 7: 重構 Windows hook 支援組合鍵
  - File: `src-tauri/src/plugins/hotkey_listener.rs`
  - Action:
    - 重構 `HookContext` struct：用 `shared: Arc<Mutex<HotkeySharedState>>` 取代原有的獨立 `trigger_key` + `trigger_mode` Arc。`key_handler` 和 `escape_handler` 閉包改為 close over 新的 `shared` Arc
    - `OnceLock<HookContext>` 保留（hook 只安裝一次），但 `shared` 是 Arc，`update_config` 更新 Mutex 內容即生效
    - hook_proc：一次 lock `shared` → 取 trigger_key + trigger_mode + 用 `GetKeyState` 更新 active_modifiers → 釋放
    - Combo 比對：`GetKeyState(VK_XXX) & 0x8000` 檢查修飾鍵 + `vkCode` 比對主鍵
    - Combo release：修飾鍵 KeyUp 或主鍵 KeyUp → 觸發 release

- [x] Task 8: 前端 double-tap handler
  - File: `src/stores/useVoiceFlowStore.ts`
  - Action:
    - 新增 `pendingDoubleTap: ref<boolean>(false)` + `doubleTapDelayTimer`
    - 修改 `handleStopRecording()`：在 **開頭**（`invoke("stop_recording")` 之前），用 `recordingElapsedSeconds` 預估 duration，若 < 0.3s → 立即設 `pendingDoubleTap = true` + 啟動 350ms 延遲 timer。`invoke("stop_recording")` 回來後，若 `pendingDoubleTap` 已被 mode-toggle 清除 → return。否則到 timer 結束時正常 `failRecordingFlow`
    - 在 `initialize()` 新增 `listenToEvent(HOTKEY_MODE_TOGGLE, () => handleDoubleTapModeToggle())`（無 payload，直接 `()`）
    - `handleDoubleTapModeToggle()`：如果 `pendingDoubleTap` → clearTimeout + 靜默取消（transitionTo "idle"）+ 切換 `settingsStore.promptMode`（minimal ↔ active）+ `settingsStore.savePromptMode(nextMode)` + 設 `modeSwitchLabel` 觸發 HUD 閃現
    - 新增 `modeSwitchLabel: ref<string>("")` + 800ms auto-clear
    - `cleanup()` 中清除 timer

- [x] Task 9: HUD prompt mode badge + mode-switch 閃現
  - File: `src/components/NotchHud.vue`
  - Action:
    - 新增 props：`promptModeLabel: string`, `modeSwitchLabel: string`
    - `VisualMode` 新增 `"mode-switch"`
    - recording 右側 badge：`<span v-if="props.promptModeLabel" class="text-[10px] px-1.5 py-0.5 rounded bg-white/15 text-white/70">{{ props.promptModeLabel }}</span>`
    - mode-switch：notch 中央顯示 label，800ms 後 collapse
    - `NOTCH_SHAPE_OVERRIDES["mode-switch"] = { width: 200, height: 36, topRadius: 12, bottomRadius: 18 }`
  - File: `src/App.vue`
  - Action: 計算 `promptModeLabel`：
    - `minimal` → `t('settings.prompt.modeMinimal')`
    - `active` → `t('settings.prompt.modeActive')`
    - `custom` → `t('settings.prompt.modeCustom')`
    - 傳 `modeSwitchLabel` 從 `voiceFlowStore.modeSwitchLabel`

- [x] Task 10: 組合鍵錄製 UI
  - File: `src/views/SettingsView.vue`
  - Action: 修改 `handleKeydownForRecording`：
    - **移除 `once: true`**，改為持續 listener + 狀態累積模式：開始錄製後持續監聽 keydown，等使用者按住修飾鍵後再按主鍵 → 捕獲完整組合 → 移除 listener。只按修飾鍵不放（無主鍵）→ 維持等待
    - 捕獲 `event.metaKey/ctrlKey/altKey/shiftKey` + `event.code`
    - 修飾鍵本身（無其他修飾）→ 單鍵模式（現有行為）
    - 修飾鍵 + 非修飾主鍵 → combo：`{ combo: { modifiers, keycode } }`
    - 非修飾鍵單獨 → 單鍵 custom（現有行為）
    - ESC 作為主鍵（含 ⌘+ESC）→ 拒絕，顯示「ESC 為保留鍵」
    - 錄鍵 UI 顯示組合鍵名稱（⌘+J）
    - 錄鍵超時（10s）仍保留
  - File: `src/lib/keycodeMap.ts`
  - Action: 新增 `getComboTriggerKeyDisplayName(combo: ComboTriggerKey): string`：修飾鍵符號（⌘/⌃/⌥/⇧）+ 主鍵名稱，以 `+` 連接
  - File: `src/stores/useSettingsStore.ts`
  - Action:
    - 修改 `saveCustomTriggerKey` 支援 combo（或新增 `saveComboTriggerKey`），持久化 combo + domCode
    - **修改 `getTriggerKeyDisplayName()`**：新增 `isComboTriggerKey` 分支，呼叫 `getComboTriggerKeyDisplayName`。現有 preset + custom 分支不變

- [x] Task 11: 設定 UI Combo-aware 調整
  - File: `src/views/SettingsView.vue`
  - Action:
    - **修改 `onMounted` 的 `isCustomMode` 判斷**：`isCustomTriggerKey(key) || isComboTriggerKey(key)` → `isCustomMode = true`
    - **修改 `currentPresetKey` computed**：新增 `isComboTriggerKey` 判斷，Combo 時回傳 null（進入 custom 模式）
    - 自訂鍵區域：顯示組合鍵名稱（如「⌘+J」），用 `getTriggerKeyDisplayName`
    - 底部加 info 提示：「長按模式下，快速按兩下觸發鍵可切換語音模式」
  - Notes: Combo 從 UI 角度等同「進階自訂」，與 Custom 共用同一區塊

- [x] Task 12: i18n 新增翻譯 key（5 語言）
  - Files: `src/i18n/locales/{zh-TW,en,ja,zh-CN,ko}.json`
  - Action:
    - `settings.hotkey.doubleTapHint` — 「長按模式下，快速按兩下觸發鍵可切換語音模式」
    - `settings.hotkey.comboKey` — 「組合鍵」
    - `voiceFlow.modeSwitched` — 「已切換至{mode}模式」
    - `voiceFlow.commandMode` — 「指令模式」（Phase 2 用）

### Phase 2: 選取文字編輯（獨立 PR，macOS only）

- [ ] Task 13: Rust 擴展 text_field_reader 讀取選取文字
  - File: `src-tauri/src/plugins/text_field_reader.rs`
  - Action: 新增 `TextFieldInfo { context_text, selected_text, has_selection }` + command `read_text_field_with_selection`
  - macOS: `AXSelectedTextRange` 的 `length > 0` → 擷取選取文字
  - Windows: no-op，`has_selection: false`
  - File: `src-tauri/src/lib.rs` — 註冊 command

- [ ] Task 14: 指令模式 prompt template
  - File: `src/i18n/prompts.ts`
  - Action: 新增 `COMMAND_MODE_PROMPTS` × 5 語言 + `getCommandModePrompt(locale, selectedText)`

- [ ] Task 15: VoiceFlow 指令模式流程
  - File: `src/stores/useVoiceFlowStore.ts`
  - Action:
    - 新增 `activeCommandContext: ref<{ selectedText: string } | null>(null)`
    - `handleStartRecording()`：只在 macOS + AX 權限已授予時呼叫 `invoke("read_text_field_with_selection")`，用 `Promise.race` 設 **500ms timeout**（避免 AX API hang 延遲錄音啟動），try-catch 包裹，超時或失敗靜默 fallback。有選取 → 設 `activeCommandContext`
    - `handleStopRecording()`：如果 `activeCommandContext` → 用 command mode prompt + 語音當指令
    - 失敗靜默 fallback 正常流程

- [ ] Task 16: HUD 指令模式標示
  - File: `src/App.vue`
  - Action: `activeCommandContext` 存在時 `promptModeLabel = t('voiceFlow.commandMode')`

### Acceptance Criteria

**Phase 1: 組合鍵 + Double-tap + HUD**

- [ ] AC 1: Given 自訂錄鍵模式, when 按 ⌘+J, then UI 顯示「⌘+J」，儲存為 combo 觸發鍵
- [ ] AC 2: Given ⌘+J 為觸發鍵 + Hold 模式, when 按住 ⌘+J, then 錄音。when 放開 J 或放開 ⌘, then 停止
- [ ] AC 3: Given Fn+Hold+精簡（單鍵）, when 快速按兩下 Fn（hold < 300ms, gap < 350ms）, then HUD 閃現「積極」3s，promptMode 切為 active 並持久化
- [ ] AC 4: Given ⌘+J+Hold+精簡（組合鍵）, when 按住 ⌘ 快速點兩下 J, then HUD 閃現「積極」3s，promptMode 切為 active 並持久化
- [ ] AC 5: Given 已切為 active, when 再次 double-tap 或長按, then HUD 閃現「精簡」，切回 minimal
- [ ] AC 6: Given Fn+Hold, when 按住 Fn > 300ms, then 正常錄音，無 double-tap
- [ ] AC 7: Given Fn+Toggle 模式, when 短按（< 1s）, then toggle on/off。when 長按（≥ 1s），then HUD 閃現模式名稱 3s，切換 promptMode
- [ ] AC 7a: Given Toggle 模式 + 錄鍵 UI, when 按 Fn 一下, then 錄製為單鍵「Fn」（Rust-driven 錄鍵偵測）
- [ ] AC 8: Given 錄音中 + 精簡模式, when HUD 顯示, then 右側顯示 [精簡]
- [ ] AC 9: Given 錄音中 + 自訂模式, when HUD 顯示, then 右側顯示 [自訂]
- [ ] AC 10: Given 錄鍵模式, when 按 ⌘+ESC, then 顯示「ESC 為保留鍵」拒絕
- [ ] AC 11: Given 舊版設定有 `customTriggerKey`, when 升級啟動, then 正常載入（向下相容，combo 是新 variant 不影響舊設定）

**Phase 2: 選取文字編輯**

- [ ] AC 12: Given macOS TextEdit 選取「你好世界」, when 按快捷鍵口述「翻譯成英文」, then LLM 處理並貼回取代
- [ ] AC 13: Given macOS 無選取, when 按快捷鍵, then 正常轉錄
- [ ] AC 14: Given Windows, when 有選取文字按快捷鍵, then 忽略選取，正常轉錄
- [ ] AC 15: Given macOS 有選取, when HUD 顯示, then 標籤為 [指令]

## Additional Context

### Dependencies

- **無新增外部依賴**
- Rust `TriggerKey` enum 新增 variant 需 `cargo check` + serde roundtrip test
- 前端 `TriggerKey` 擴展需 `npx vue-tsc --noEmit`
- Phase 2 依賴 Phase 1（HUD label 機制）

### Testing Strategy

**Rust 測試**（`#[cfg(test)]`）：
- [P0] `TriggerKey::Combo` serde JSON roundtrip
- [P0] `matches_combo_trigger`（全 match, partial miss, wrong modifier）
- [P1] `check_double_tap` 時間邊界（< 350ms pass, > 350ms fail, hold > 300ms fail, Toggle skip）
- [P0] 向下相容：舊 `TriggerKey` JSON（preset + custom）仍能反序列化

**前端 Vitest**（`tests/unit/`）：
- [P0] `isComboTriggerKey` type guard
- [P0] `getComboTriggerKeyDisplayName` 格式化（⌘+J、⌃+⇧+Space 等）
- [P0] `getTriggerKeyDisplayName` 三 variant 測試（preset / custom / combo 都不 crash）
- [P1] double-tap mode toggle（minimal ↔ active，持久化驗證）
- [P0] 更新現有 `settingsStore.test.ts` 適配 `TriggerKey` 新 variant

**手動測試**：
- `pnpm tauri dev` 雙平台（macOS 必測，Windows best-effort）
- 組合鍵錄製（按住 ⌘ 再按 J → 正確捕獲，只按 ⌘ 不放 → 維持等待，超時 10s → 取消）
- 組合鍵觸發 + release（先放修飾 / 先放主鍵 / 同時放 → 都停止）
- 單鍵 double-tap + 組合鍵 double-tap（按住 ⌘ 點兩下 J）
- double-tap 邊界（300ms hold / 350ms gap）
- HUD 顯示三種模式標籤（精簡/積極/自訂）
- Phase 2: TextEdit、Notes、VS Code、Chrome 選取偵測

### Notes

**高風險項目：**
- 單一 Mutex lock 時間需最短化（callback 內只讀 config，不做 IO）
- Double-tap 競態：`waitForDoubleTapResolution` Promise 必須在 `invoke("stop_recording")` 之前 await。ESC abort 時必須 resolve(false) 避免 suspend
- Toggle 長按：spawn thread sleep 1s 後檢查 `is_pressed`，使用 `toggle_long_press_fired` flag 防止 release 時重複 toggle
- Rust-driven 錄鍵：recording mode 時 CGEventTap/hook callback 跳過所有 trigger 邏輯。Fn 鍵用 toggle-based（keycode 63）偵測
- `getTriggerKeyDisplayName` 必須處理 Combo variant，否則 runtime crash
- mode-switch HUD 生命週期：store 設 `modeSwitchLabel` + `showHud()`，3s 後清 label + `transitionTo("idle")` 觸發 collapse（與 success 流程一致）

**已知限制：**
- Windows 無 Fn 鍵偵測（firmware 層）
- Windows 無選取文字編輯
- Mode toggle 不含 custom 模式（只在 minimal ↔ active 循環）
- Toggle 模式改為 release-based，短按有 ~100-200ms 延遲

**未來考量（out of scope）：**
- 多組快捷鍵 Slot
- 選取文字編輯的 Clipboard fallback
- Windows UI Automation
