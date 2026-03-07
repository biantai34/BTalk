---
title: '多國語言切換功能（i18n）'
slug: 'i18n-multi-language'
created: '2026-03-08'
status: 'done'
stepsCompleted: [1, 2, 3, 4]
adversarial_review: 'completed — 16 findings addressed'
tech_stack: ['vue-i18n ^11', 'vue ^3.5', 'tauri-plugin-store ^2.4.2', 'Rust transcription.rs']
files_to_modify:
  - 'src/main.ts'
  - 'src/main-window.ts'
  - 'src/MainApp.vue'
  - 'src/stores/useSettingsStore.ts'
  - 'src/stores/useVoiceFlowStore.ts'
  - 'src/stores/useVocabularyStore.ts'
  - 'src/lib/enhancer.ts'
  - 'src/lib/errorUtils.ts'
  - 'src/lib/formatUtils.ts'
  - 'src/lib/keycodeMap.ts'
  - 'src/views/SettingsView.vue'
  - 'src/views/DashboardView.vue'
  - 'src/views/HistoryView.vue'
  - 'src/views/DictionaryView.vue'
  - 'src/components/AccessibilityGuide.vue'
  - 'src/components/DashboardUsageChart.vue'
  - 'src-tauri/src/plugins/transcription.rs'
  - 'src/types/events.ts'
  - 'tests/component/AccessibilityGuide.test.ts'
  - 'tests/unit/use-voice-flow-store.test.ts'
files_to_create:
  - 'src/i18n/index.ts'
  - 'src/i18n/locales/zh-TW.json'
  - 'src/i18n/locales/en.json'
  - 'src/i18n/locales/ja.json'
  - 'src/i18n/locales/zh-CN.json'
  - 'src/i18n/locales/ko.json'
  - 'src/i18n/prompts.ts'
  - 'src/i18n/languageConfig.ts'
  - 'tests/unit/i18n-settings.test.ts'
  - 'tests/component/i18n-smoke.test.ts'
code_patterns:
  - 'Settings Store: load() -> get() -> set() -> save() -> emitEvent()'
  - 'Cross-window sync: refreshCrossWindowSettings() reads store and updates ref'
  - 'Rust command: #[command] pub async fn + State<> + Option<> params'
  - 'enhanceText: already supports options.systemPrompt dynamic injection'
  - 'VoiceFlow invoke: invoke("transcribe_audio", { apiKey, vocabularyTermList, modelId })'
  - 'Dual WebView: HUD and Dashboard are separate JS runtimes, NOT shared singleton'
test_patterns:
  - 'Vitest + jsdom, vi.mock @tauri-apps series'
  - 'Store test: import -> useStore() -> call method -> expect mockStoreSet'
  - 'Component test: mount + props -> trigger -> assert'
  - '14 test files in tests/unit/ and tests/component/'
---

# Tech-Spec: 多國語言切換功能（i18n）

**Created:** 2026-03-08
**Adversarial Review:** Completed — 16 findings addressed (2 Critical, 4 High, 7 Medium, 3 Low)

## Overview

### Problem Statement

目前所有 UI 文字、AI Prompt 預設值、Whisper 識別語言都硬編碼為繁體中文，國際使用者無法使用母語介面操作應用程式。此外，現有的幻覺檢測邏輯隱含「使用者語言 = 中文」的假設，多語言後會導致非中文轉錄被誤殺。

### Solution

導入 `vue-i18n`，建立 5 種語言翻譯檔（zh-TW、en、ja、zh-CN、ko），在設定頁面新增語言切換器，同時連動 Whisper 識別語言與 AI Prompt 預設值。首次啟動自動偵測系統語言，偵測不到時 fallback 為 `zh-TW`（保護既有中文使用者的升級體驗）。同時修復幻覺檢測的語言假設問題和錯誤處理中的字串耦合。

### Scope

**In Scope:**

1. **vue-i18n 基礎建設** — 安裝套件、建立 locale JSON 檔（zh-TW、en、ja、zh-CN、ko）
2. **UI 翻譯** — Dashboard 所有 views + MainApp sidebar + HUD 視窗 + 元件 + lib 層
3. **設定頁面新增語言選擇器** — 在「應用程式」Card 中新增語言下拉選單
4. **系統語言自動偵測** — 首次啟動偵測系統語言，偵測不到時 fallback 為 `zh-TW`
5. **語言偏好持久化** — 存入 `tauri-plugin-store`
6. **Whisper 語言連動** — UI 語言切換時，Rust 端 `TRANSCRIPTION_LANGUAGE` 改為動態參數
7. **AI Prompt 多語言預設** — `DEFAULT_SYSTEM_PROMPT` 改為每種語言一份預設 prompt
8. **HTML lang 屬性** — 動態切換
9. **幻覺檢測修復** — `isSilenceOrHallucination` 的 CJK 檢查改為僅在 Whisper language = `"zh"` 時啟用
10. **錯誤處理重構** — `enhancer.ts` 的錯誤改用結構化 Error（帶 `statusCode` 屬性），消除 `errorUtils.ts` 對全形冒號的字串耦合

**Out of Scope:**

- Rust 後端 log 訊息翻譯
- 使用者自訂 prompt 的自動翻譯（只改預設值，使用者已自訂的不動）
- RTL 排版支援
- `SiteHeader.vue` — 只接收 prop 顯示，無硬編碼字串，不需修改

## Context for Development

### Codebase Patterns

**Settings Store Pattern（新增設定項標準流程）：**

```
1. 定義常數 DEFAULT_XXX + 型別
2. 宣告 ref<Type>(DEFAULT_XXX)
3. loadSettings() 中 store.get<Type>("key") ?? DEFAULT_XXX
4. saveXxx() 中 store.set("key", value) -> store.save() -> 更新 ref -> emitEvent(SETTINGS_UPDATED)
5. refreshCrossWindowSettings() 中重新 get 並更新 ref
6. return { ref, saveXxx }
```

**雙視窗架構（重要）：**

HUD（`index.html` / `main.ts`）和 Dashboard（`main-window.html` / `main-window.ts`）是**兩個獨立的 Tauri WebView**，各自有獨立的 JS runtime。import 同一個 `src/i18n/index.ts` 會在各自的 runtime 中各建立一個 `createI18n()` instance。它們**不是** singleton。語言切換時透過 `emitEvent(SETTINGS_UPDATED)` + `refreshCrossWindowSettings()` 做跨視窗同步，在 refresh 中必須同步更新 `i18n.global.locale.value` 和 `document.documentElement.lang`。

**Rust Command Pattern（transcribe_audio 現有簽名）：**

```rust
#[command]
pub async fn transcribe_audio(
    state: State<'_, AudioRecorderState>,
    transcription_state: State<'_, TranscriptionState>,
    api_key: String,
    vocabulary_term_list: Option<Vec<String>>,
    model_id: Option<String>,
) -> Result<TranscriptionResult, TranscriptionError>
```

語言硬編碼為常數：`const TRANSCRIPTION_LANGUAGE: &str = "zh";`
使用於 multipart form：`.text("language", TRANSCRIPTION_LANGUAGE)`

**VoiceFlow 呼叫點（用 code pattern 定位，非行號）：**

- `invoke("transcribe_audio", { apiKey, vocabularyTermList, modelId })` — 在 `handleStopRecording()` 中
- `enhanceText(result.rawText, apiKey, { systemPrompt, vocabularyTermList, modelId })` — 在 `handleStopRecording()` 的 enhance 階段

**錯誤處理字串耦合（Critical — F2）：**

`enhancer.ts` 的 `enhanceText()` 拋出含全形冒號的 Error：`"AI 整理失敗：${status} ${statusText}..."`。`errorUtils.ts` 的 `getEnhancementErrorMessage()` 用 `error.message.match(/：(\d+)/)` 提取 status code。翻譯後全形冒號會消失，導致 status code 解析壞掉。必須改用結構化 Error。

### 硬編碼字串盤點

| 區域 | 檔案數 | 估計字串數 | 備註 |
| ---- | ------ | ---------- | ---- |
| SettingsView.vue | 1 | ~55 | Card 標題 + Label + 描述 + 按鈕 + feedback + trigger key labels |
| MainApp.vue | 1 | ~24 | sidebar nav labels(4) + 更新相關訊息(15+) + AlertDialog(5+) |
| DashboardView.vue | 1 | ~19 | 統計卡片、配額標籤 |
| HistoryView.vue | 1 | ~16 | 搜尋、表頭、空狀態、操作按鈕 |
| DictionaryView.vue | 1 | ~11 | 標題、placeholder、Badge、feedback |
| errorUtils.ts | 1 | ~24 | 所有使用者可見錯誤訊息 |
| useVoiceFlowStore.ts | 1 | ~12 | HUD 狀態(5) + 空轉錄(1) + 貼上失敗(1) + 錄音太短(1) + 其他 |
| useSettingsStore.ts | 1 | ~3 | throw Error 中文字串（API Key/Prompt 空白、自訂鍵顯示） |
| AccessibilityGuide.vue | 1 | 9 | 權限對話框完整流程 |
| enhancer.ts | 1 | 3 + prompt | 錯誤訊息 + DEFAULT_SYSTEM_PROMPT 搬移 |
| formatUtils.ts | 1 | 4 + locale | 時間格式 + `toLocaleString("zh-TW")` 需動態化 |
| DashboardUsageChart.vue | 1 | 2 | 圖表圖例 + 空狀態 |
| useVocabularyStore.ts | 1 | 2 | 重複詞彙錯誤 |
| keycodeMap.ts | 1 | 1 | 按鍵碰撞警告 |
| **總計** | **14** | **~185** | 不含 prompt（獨立計算） |

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `src/views/SettingsView.vue` | 新增語言選擇器 + ~55 個字串翻譯 |
| `src/MainApp.vue` | sidebar nav + 更新對話框，~24 個字串翻譯 |
| `src/views/DashboardView.vue` | 儀表板，~19 個字串翻譯 |
| `src/views/HistoryView.vue` | 歷史記錄，~16 個字串翻譯 |
| `src/views/DictionaryView.vue` | 詞彙管理，~11 個字串翻譯 |
| `src/stores/useSettingsStore.ts` | 新增 locale 設定 + prompt 連動 + 既有 throw 字串翻譯 |
| `src/stores/useVoiceFlowStore.ts` | invoke 加 language + HUD 狀態 + 貼上失敗 + 錄音太短翻譯 + 幻覺檢測修復 |
| `src/stores/useVocabularyStore.ts` | 2 個錯誤字串翻譯 |
| `src/lib/enhancer.ts` | prompt 多語言 + 錯誤改用結構化 Error |
| `src/lib/errorUtils.ts` | ~24 個錯誤訊息翻譯 + 移除全形冒號 regex 依賴 |
| `src/lib/formatUtils.ts` | 4 個時間格式翻譯 + `toLocaleString` locale 動態化 |
| `src/lib/keycodeMap.ts` | 1 個按鍵碰撞警告翻譯 |
| `src/components/AccessibilityGuide.vue` | 9 個權限對話框字串翻譯 |
| `src/components/DashboardUsageChart.vue` | 2 個圖表字串翻譯 |
| `src-tauri/src/plugins/transcription.rs` | 硬編碼 `"zh"` 改為動態 `language` 參數 |
| `src/main.ts` | HUD 入口，初始化 vue-i18n |
| `src/main-window.ts` | Dashboard 入口，初始化 vue-i18n |

### Technical Decisions

- **vue-i18n** — Vue 生態最成熟的 i18n 方案，支援 Composition API `useI18n()`
- 語言偏好存入 `tauri-plugin-store`，與其他設定一致
- Whisper 語言從前端傳入 Rust（新增 `language: Option<String>` 參數）
- AI Prompt 以 `src/i18n/prompts.ts` 集中管理 5 語言版本（prompt 過長不適合 JSON）
- 語言設定切換時，若使用者 prompt 等於當前語言預設值，自動換為新語言預設；已自訂則保留
- `errorUtils.ts`、`formatUtils.ts` 等 lib 層透過全域 i18n instance（`i18n.global.t`）翻譯
- **雙視窗不是 singleton** — 兩個獨立的 vue-i18n instance，透過 Tauri event + `refreshCrossWindowSettings()` 同步
- **升級路徑保護** — 首次啟動偵測不到支援語言時 fallback 為 `zh-TW`（而非 `en`），避免既有中文使用者更新後 Whisper 被切為英文
- **`navigator.languages` 已驗證可靠** — macOS WKWebView 和 Windows WebView2 皆回傳系統語言。已知 Apple 可能截斷地區碼（如 `"zh-Hant"` 而非 `"zh-Hant-TW"`），偵測邏輯需支援 script subtag 前綴匹配
- **結構化 Error** — `enhancer.ts` 錯誤改用帶 `statusCode` 屬性的 Error，消除 `errorUtils.ts` 對字串內容的依賴

### 語言對應表

| 語言 | locale key | Whisper code | HTML lang | 顯示名稱 | navigator.languages 匹配 |
| ---- | ---------- | ------------ | --------- | --------- | ----------------------- |
| 繁體中文 | `zh-TW` | `zh` | `zh-Hant` | 繁體中文 | `zh-Hant-TW`, `zh-Hant`, `zh-TW` |
| English | `en` | `en` | `en` | English | `en-*`, `en` |
| 日本語 | `ja` | `ja` | `ja` | 日本語 | `ja-*`, `ja` |
| 简体中文 | `zh-CN` | `zh` | `zh-Hans` | 简体中文 | `zh-Hans-*`, `zh-Hans`, `zh-CN`, `zh` |
| 한국어 | `ko` | `ko` | `ko` | 한국어 | `ko-*`, `ko` |

匹配優先順序：精確匹配 → script subtag 匹配（`zh-Hant` → `zh-TW`、`zh-Hans` → `zh-CN`）→ 語言前綴匹配（`ja-JP` → `ja`）→ fallback `zh-TW`

## Implementation Plan

### Tasks

#### Phase 1：i18n 基礎建設 + 初始化（無現有功能依賴）

- [ ] Task 1: 安裝 vue-i18n
  - File: `package.json`
  - Action: `pnpm add vue-i18n`
  - Notes: vue-i18n ^10 for Vue 3

- [ ] Task 2: 建立語言設定型別和對應表
  - File: `src/i18n/languageConfig.ts`（新建）
  - Action: 定義 `SupportedLocale` 型別（`'zh-TW' | 'en' | 'ja' | 'zh-CN' | 'ko'`）、`LANGUAGE_OPTIONS` 陣列（含 locale key、顯示名稱、Whisper code、HTML lang、navigator 匹配 pattern）、`FALLBACK_LOCALE: SupportedLocale = 'zh-TW'` 常數、`detectSystemLocale()` 函式
  - Notes: 偵測邏輯必須支援 Apple 截斷的 script subtag：
    1. 精確匹配（`zh-Hant-TW` → `zh-TW`）
    2. Script subtag 匹配（`zh-Hant` → `zh-TW`、`zh-Hans` → `zh-CN`）
    3. 語言前綴匹配（`ja-JP` → `ja`、`ko-KR` → `ko`、`en-US` → `en`）
    4. 裸 `zh` 匹配 → `zh-TW`（保護繁中使用者）
    5. Fallback `zh-TW`（而非 `en`，保護既有使用者升級路徑）

- [ ] Task 3: 建立繁體中文翻譯檔（基準語言）
  - File: `src/i18n/locales/zh-TW.json`（新建）
  - Action: 從現有硬編碼字串提取所有 ~185 個翻譯鍵。鍵名結構按功能分組：
    ```
    {
      "settings": { "title": "...", "hotkey": { ... }, "apiKey": { ... }, "app": { ... }, ... },
      "dashboard": { ... },
      "history": { ... },
      "dictionary": { ... },
      "accessibility": { ... },
      "voiceFlow": { "recording": "錄音中...", "transcribing": "轉錄中...", "pasteFailed": "貼上失敗", "recordingTooShort": "錄音時間太短", ... },
      "errors": { "micInitFailed": "麥克風初始化失敗", "apiKeyEmpty": "API Key 不可為空白", "promptEmpty": "Prompt 不可為空白", ... },
      "format": { "minutes": "{totalMinutes} 分鐘", ... },
      "mainApp": { "nav": { ... }, "update": { ... } },
      "common": { "save": "儲存", "delete": "刪除", "cancel": "取消", ... }
    }
    ```
  - Notes: 使用 vue-i18n 的 named interpolation `{variable}` 語法處理動態值

- [ ] Task 4: 建立其他 4 種語言翻譯檔
  - Files: `src/i18n/locales/en.json`, `ja.json`, `zh-CN.json`, `ko.json`（新建）
  - Action: 以 `zh-TW.json` 為基準翻譯所有鍵。每個檔案結構完全一致，值為對應語言。
  - Notes: en.json 為 vue-i18n fallback 語言，必須 100% 完整。其他語言缺失鍵會 fallback 到 en。

- [ ] Task 5: 建立多語言 AI Prompt
  - File: `src/i18n/prompts.ts`（新建）
  - Action: 匯出 `DEFAULT_PROMPTS: Record<SupportedLocale, string>`，每種語言一份完整校對指令 prompt。匯出 `getDefaultPromptForLocale(locale: SupportedLocale): string` 函式。
  - Notes: zh-TW prompt 直接從現有 `enhancer.ts` 的 `DEFAULT_SYSTEM_PROMPT` 搬移。每份 prompt 最後一句指定輸出語言。

- [ ] Task 6: 建立 vue-i18n instance
  - File: `src/i18n/index.ts`（新建）
  - Action: 建立並匯出 `i18n` instance（`createI18n({ legacy: false, locale: FALLBACK_LOCALE, fallbackLocale: 'en', messages })`）
  - Notes: `legacy: false` 啟用 Composition API。locale 初始為 `FALLBACK_LOCALE`，啟動時由 Settings Store 覆蓋。注意：兩個 WebView 各自建立自己的 instance，不是 singleton。

- [ ] Task 7: HUD 入口初始化
  - File: `src/main.ts`
  - Action: 在 `app.use(pinia)` 後加入 `app.use(i18n)`（import from `@/i18n`）
  - Notes: 必須在 Pinia 之後、mount 之前。Phase 1 就完成初始化，讓後續 Phase 可獨立驗證。

- [ ] Task 8: Dashboard 入口初始化
  - File: `src/main-window.ts`
  - Action: 同 Task 7，在 `app.use(pinia)` 後加入 `app.use(i18n)`

- [ ] Task 9: HTML lang 初始值
  - Files: `index.html`, `main-window.html`
  - Action: 將 `lang="zh-Hant"` 改為 `lang="zh-Hant"`（保持不變，啟動後由 JS 覆蓋為使用者偏好）
  - Notes: 啟動時 Settings Store `loadSettings()` 會設定正確的 `document.documentElement.lang`。保持 `zh-Hant` 而非改為 `en`，因為 fallback 是 `zh-TW`。

#### Phase 2：設定層整合

- [ ] Task 10: Settings Store 新增語言設定
  - File: `src/stores/useSettingsStore.ts`
  - Action:
    1. import `SupportedLocale`, `detectSystemLocale`, `LANGUAGE_OPTIONS`, `FALLBACK_LOCALE` from `@/i18n/languageConfig`
    2. import `getDefaultPromptForLocale` from `@/i18n/prompts`
    3. import `i18n` from `@/i18n`
    4. 新增 `selectedLocale = ref<SupportedLocale>(FALLBACK_LOCALE)`
    5. 在 `loadSettings()` 中：讀取 `store.get<SupportedLocale>('selectedLocale')`，若無值（首次啟動 / 升級）則呼叫 `detectSystemLocale()` 並存入 store
    6. `loadSettings()` 中載入 locale 後**必須立即同步** `i18n.global.locale.value` 和 `document.documentElement.lang`（查表取 HTML lang）
    7. 新增 `saveLocale(locale: SupportedLocale)` — set store + update ref + 更新 `i18n.global.locale.value` + 更新 `document.documentElement.lang` + emitEvent
    8. 新增 `getWhisperLanguageCode(): string` — 從 `LANGUAGE_OPTIONS` 查找當前 locale 對應的 Whisper code
    9. **`refreshCrossWindowSettings()` 修改順序（Critical）**：必須先讀取並更新 `selectedLocale` + 同步 `i18n.global.locale.value` + `document.documentElement.lang`，**然後**再處理 `aiPrompt` fallback（因為 aiPrompt fallback 依賴 `selectedLocale` 的值來決定用哪個語言的預設 prompt）
    10. `refreshCrossWindowSettings()` 中的 `aiPrompt` fallback：從 `savedPrompt?.trim() || DEFAULT_SYSTEM_PROMPT` 改為 `savedPrompt?.trim() || getDefaultPromptForLocale(selectedLocale.value)`
    11. return 中加入 `selectedLocale`, `saveLocale`, `getWhisperLanguageCode`
  - Notes: 遵循現有 pattern。`SETTINGS_UPDATED` event payload key 用 `"locale"`。

- [ ] Task 11: Settings Store prompt 切換連動
  - File: `src/stores/useSettingsStore.ts`
  - Action: 在 `saveLocale()` 中加入 prompt 連動邏輯：
    1. 取得切換前的語言預設 prompt：`getDefaultPromptForLocale(oldLocale)`
    2. 比較當前 `aiPrompt.value` 是否等於舊語言預設 prompt
    3. 若相等（使用者未自訂），自動更新為新語言預設 prompt 並儲存
    4. 若不相等（使用者已自訂），保持不動
    5. 修改 `resetAiPrompt()` 以使用 `getDefaultPromptForLocale(selectedLocale.value)` 取代固定的 `DEFAULT_SYSTEM_PROMPT`
  - Notes: 同時翻譯 Store 中的既有 throw Error 字串：`"API Key 不可為空白"`、`"Prompt 不可為空白"`、自訂鍵顯示格式，改用 `i18n.global.t()`。

- [ ] Task 12: 修改 enhancer.ts — prompt 多語言 + 結構化 Error
  - File: `src/lib/enhancer.ts`
  - Action:
    1. 移除 `DEFAULT_SYSTEM_PROMPT` 常數（搬到 `src/i18n/prompts.ts`）
    2. 改為 import `getDefaultPromptForLocale` 和 `i18n`
    3. 新增 `getDefaultSystemPrompt(): string`，回傳 `getDefaultPromptForLocale(i18n.global.locale.value as SupportedLocale)`
    4. `enhanceText()` 中的 fallback：`options?.systemPrompt || getDefaultSystemPrompt()`
    5. **結構化 Error（Critical — F2）**：`enhanceText()` 的 HTTP 錯誤改用自訂 Error class：
       ```typescript
       class EnhancerApiError extends Error {
         constructor(public statusCode: number, statusText: string, body: string) {
           super(`Enhancement API error: ${statusCode}`);
         }
       }
       ```
       拋出 `new EnhancerApiError(response.status, response.statusText, errorBody)` 取代含全形冒號的字串拼接
    6. timeout 錯誤也改為自訂 class 或帶 `code` 屬性
  - Notes: `DEFAULT_SYSTEM_PROMPT` 被測試引用，需同步更新 import。匯出 `EnhancerApiError` 給 `errorUtils.ts` 使用。

#### Phase 3：Rust 後端 + VoiceFlow 整合

- [ ] Task 13: 修改 transcribe_audio 支援動態語言
  - File: `src-tauri/src/plugins/transcription.rs`
  - Action:
    1. 在 `transcribe_audio` 函式簽名加入 `language: Option<String>` 參數
    2. 修改 multipart form 構建：`.text("language", language.as_deref().unwrap_or(TRANSCRIPTION_LANGUAGE))`
    3. `TRANSCRIPTION_LANGUAGE` 保留為 fallback 預設值 `"zh"`
  - Notes: `Option<String>` 確保向後相容。

- [ ] Task 14: VoiceFlow Store 傳遞語言參數 + 翻譯 + 幻覺檢測修復
  - File: `src/stores/useVoiceFlowStore.ts`
  - Action:
    1. import `i18n` from `@/i18n`
    2. 在 `invoke("transcribe_audio", ...)` 加入 `language: settingsStore.getWhisperLanguageCode()`
    3. HUD 狀態訊息改用 `i18n.global.t('voiceFlow.recording')` 等翻譯鍵
    4. 空轉錄訊息改用 `i18n.global.t('voiceFlow.noSpeechDetected')`
    5. `"貼上失敗"` 改用 `i18n.global.t('voiceFlow.pasteFailed')`
    6. `"錄音時間太短"` 改用 `i18n.global.t('voiceFlow.recordingTooShort')`
    7. **幻覺檢測修復（Critical — F1）**：`isSilenceOrHallucination()` 函式中的 CJK 檢查（`!CJK_REGEX.test(rawText) && hasRepeatedTokens(rawText)`）加入語言條件，只在 `settingsStore.getWhisperLanguageCode() === 'zh'` 時啟用 CJK 檢查。非中文 locale 下跳過此分支，避免英文/韓文正常轉錄被誤殺。
  - Notes: 幻覺檢測短語列表（`HALLUCINATION_PHRASES`）本身不翻譯，那些是 Whisper 的固定輸出。

#### Phase 4：UI 翻譯替換

- [ ] Task 15: 翻譯 errorUtils.ts + 移除字串耦合
  - File: `src/lib/errorUtils.ts`
  - Action:
    1. import `i18n` from `@/i18n`，所有硬編碼中文字串改為 `i18n.global.t('errors.xxx')`。約 24 個字串
    2. **移除全形冒號 regex（Critical — F2）**：`getEnhancementErrorMessage()` 中的 `error.message.match(/：(\d+)/)` 改為 `error instanceof EnhancerApiError ? error.statusCode : null`，用 instanceof 檢查取代字串解析
  - Notes: import `EnhancerApiError` from `@/lib/enhancer`。

- [ ] Task 16: 翻譯 formatUtils.ts + locale 動態化
  - File: `src/lib/formatUtils.ts`
  - Action:
    1. import `i18n`，時間格式字串改為翻譯鍵。約 4 個字串
    2. **locale 動態化（F9）**：所有 `toLocaleString("zh-TW")` 改為 `toLocaleString(i18n.global.locale.value)`。包含日期格式化和數字格式化
  - Notes: 不同語言的時間表達和數字分隔符會自動適配。

- [ ] Task 17: 翻譯 keycodeMap.ts
  - File: `src/lib/keycodeMap.ts`
  - Action: import `i18n`，按鍵碰撞警告字串改為翻譯鍵。1 個字串。

- [ ] Task 18: 翻譯 useVocabularyStore.ts
  - File: `src/stores/useVocabularyStore.ts`
  - Action: import `i18n`，`"此詞彙已存在"` 改為 `i18n.global.t('dictionary.duplicateEntry')`。2 個字串。

- [ ] Task 19: 翻譯 SettingsView.vue
  - File: `src/views/SettingsView.vue`
  - Action: `const { t } = useI18n()`。template + script 中所有硬編碼中文改為 `t('settings.xxx')`。約 55 個字串。包含：所有 Card 標題、Label、描述文字、按鈕文字、feedback 訊息、placeholder、trigger key option labels、「關於 SayIt」Card 的描述和連結文字。
  - Notes: trigger key labels（如 `"左 Option (⌥)"`）也需翻譯。feedback show 字串（如 `"觸發鍵已更新"`）改為 `t('settings.hotkey.updated')`。

- [ ] Task 20: SettingsView 新增語言選擇器
  - File: `src/views/SettingsView.vue`
  - Action: 在「應用程式」Card 中，在「錄音時自動靜音」Switch 上方新增語言選擇區塊：
    1. import `LANGUAGE_OPTIONS`, `SupportedLocale` from `@/i18n/languageConfig`
    2. 新增 `languageFeedback = useFeedbackMessage()`
    3. 新增 `handleLocaleChange(newLocale: SupportedLocale)` — 呼叫 `settingsStore.saveLocale(newLocale)` + feedback
    4. template：Label + Select 下拉（options 從 `LANGUAGE_OPTIONS` 渲染，顯示各語言原名）+ feedback transition
  - Notes: 語言名稱用原文顯示（繁體中文、English、日本語...）。在 `onBeforeUnmount` 加入 `languageFeedback.clearTimer()`。

- [ ] Task 21: 翻譯 DashboardView.vue
  - File: `src/views/DashboardView.vue`
  - Action: `const { t } = useI18n()`，~19 個字串替換。
  - Notes: 配額標籤使用 interpolation：`t('dashboard.whisperQuota', { count, limit })`

- [ ] Task 22: 翻譯 HistoryView.vue
  - File: `src/views/HistoryView.vue`
  - Action: `const { t } = useI18n()`，~16 個字串替換。

- [ ] Task 23: 翻譯 DictionaryView.vue
  - File: `src/views/DictionaryView.vue`
  - Action: `const { t } = useI18n()`，~11 個字串替換。
  - Notes: feedback 中的動態詞彙名用 interpolation：`t('dictionary.added', { term })`

- [ ] Task 24: 翻譯 AccessibilityGuide.vue
  - File: `src/components/AccessibilityGuide.vue`
  - Action: `const { t } = useI18n()`，9 個字串替換。

- [ ] Task 25: 翻譯 DashboardUsageChart.vue
  - File: `src/components/DashboardUsageChart.vue`
  - Action: `const { t } = useI18n()`，2 個字串替換。

#### Phase 5：MainApp 翻譯

- [ ] Task 26: 翻譯 MainApp.vue
  - File: `src/MainApp.vue`
  - Action: `const { t } = useI18n()`，翻譯所有 ~24 個硬編碼字串：
    - sidebar nav labels（4 個）：儀表板、歷史記錄、自訂字典、設定
    - 更新相關訊息（~15 個）：安裝失敗、檢查更新時發生錯誤、已是最新版本、檢查失敗、更新失敗、檢查中...、下載中...、安裝中...、檢查更新、已就緒、立即安裝
    - AlertDialog（~5 個）：更新已就緒、發現新版本、描述文字、稍後、安裝並重啟、取消、開始更新
  - Notes: `SiteHeader.vue` 只接收 title prop 顯示，不需修改。`currentPageTitle` 的 fallback `"SayIt"` 是品牌名不翻譯。

#### Phase 6：測試

- [ ] Task 27: 新增 i18n 設定測試
  - File: `tests/unit/i18n-settings.test.ts`（新建）
  - Action: 測試案例：
    1. `saveLocale('en')` 應正確存入 store 並更新 i18n.global.locale
    2. `saveLocale('ja')` 應更新 document.documentElement.lang 為 `'ja'`
    3. `getWhisperLanguageCode()` 應回傳正確的 Whisper code（zh-TW→zh, en→en, ja→ja, zh-CN→zh, ko→ko）
    4. `detectSystemLocale()` 精確匹配（mock `['zh-Hant-TW']` → `'zh-TW'`）
    5. `detectSystemLocale()` script subtag 匹配（mock `['zh-Hant']` → `'zh-TW'`、`['zh-Hans']` → `'zh-CN'`）
    6. `detectSystemLocale()` 前綴匹配（mock `['ja-JP']` → `'ja'`）
    7. `detectSystemLocale()` 無匹配時 fallback 為 `'zh-TW'`（mock `['th']`）
    8. 語言切換時，未自訂 prompt 自動更新為新語言預設
    9. 語言切換時，已自訂 prompt 保持不動
    10. **翻譯檔 key 一致性驗證**：所有 5 個 locale JSON 檔的 key 集合必須完全一致（遞迴比較）

- [ ] Task 28: 更新現有 enhancer 測試
  - File: `tests/unit/enhancer.test.ts`
  - Action:
    1. 更新 import（`DEFAULT_SYSTEM_PROMPT` 已移除，改用 `getDefaultPromptForLocale`）
    2. 新增測試：不同 locale 下 `getDefaultSystemPrompt()` 回傳對應語言 prompt
    3. 新增測試：HTTP 錯誤拋出 `EnhancerApiError` 且帶正確 `statusCode`

- [ ] Task 29: 更新現有 settings store 測試
  - File: `tests/unit/use-settings-store.test.ts`
  - Action: 新增 `saveLocale` / `loadSettings` 中 locale 載入的測試。確保現有測試不因 import 變動而壞掉。

- [ ] Task 30: 新增 component smoke test
  - File: `tests/component/i18n-smoke.test.ts`（新建）
  - Action: mount 一個主要 View（如 SettingsView），切換 i18n locale，斷言關鍵 UI 文字已從中文切換為英文。
  - Notes: 此測試驗證 template 中的 `{{ t('key') }}` 綁定是否正確，unit test 無法覆蓋此面向。

### Acceptance Criteria

#### 基礎建設

- [ ] AC 1: Given 使用者首次安裝 app，when app 啟動且系統語言為日文（`navigator.languages = ['ja']`），then 介面自動顯示日文 UI
- [ ] AC 2: Given 使用者首次安裝 app，when 系統語言為不支援的語言（如 `th`），then 介面 fallback 顯示繁體中文（`zh-TW`）
- [ ] AC 3: Given vue-i18n 已初始化，when 翻譯鍵在當前語言缺失，then fallback 顯示英文（`fallbackLocale: 'en'`）
- [ ] AC 4: Given 所有 5 個 locale JSON 檔案，when 比較其 key 結構，then 完全一致（無遺漏或多餘的 key）

#### 語言切換

- [ ] AC 5: Given 使用者在設定頁面，when 從語言下拉選單選擇 English，then 整個 Dashboard 介面（含 sidebar、所有 views）立即切換為英文
- [ ] AC 6: Given 使用者切換語言為日文，when 開啟 HUD 視窗，then HUD 狀態訊息（錄音中、轉錄中、已貼上）顯示日文
- [ ] AC 7: Given 使用者切換語言為韓文，when 關閉 app 並重新開啟，then 介面仍顯示韓文（語言偏好已持久化）
- [ ] AC 8: Given 雙視窗同時開啟，when 在 Dashboard 切換語言，then HUD 視窗也同步更新語言（透過 event + refreshCrossWindowSettings）

#### Whisper 語言連動

- [ ] AC 9: Given 使用者將介面語言切為 English，when 按住快捷鍵錄音並放開，then Whisper API 請求的 `language` 欄位為 `"en"`
- [ ] AC 10: Given 介面語言為繁體中文或簡體中文，when 執行語音轉錄，then Whisper `language` 欄位均為 `"zh"`

#### AI Prompt 連動

- [ ] AC 11: Given 使用者從未自訂過 AI prompt，when 語言從繁體中文切換為 English，then AI prompt 自動更新為英文版預設 prompt
- [ ] AC 12: Given 使用者已自訂 AI prompt，when 語言切換，then AI prompt 保持使用者自訂內容不變
- [ ] AC 13: Given 介面語言為日文且使用預設 prompt，when 使用者點擊「重置為預設」，then prompt 重置為日文版預設

#### 幻覺檢測（Critical — F1）

- [ ] AC 14: Given 介面語言為 English（Whisper language = `"en"`），when 使用者說 "yeah yeah okay" 並完成轉錄，then 文字正常顯示（不被 CJK 幻覺檢測誤殺）
- [ ] AC 15: Given 介面語言為繁體中文（Whisper language = `"zh"`），when Whisper 回傳純英文無 CJK 的重複文字，then 仍被正確判定為幻覺並丟棄

#### 錯誤訊息

- [ ] AC 16: Given 介面語言為 English，when AI 整理 API 回傳 401 錯誤，then 錯誤訊息顯示英文（透過 `EnhancerApiError.statusCode` 判斷，非字串解析）
- [ ] AC 17: Given 介面語言為韓文，when API Key 無效，then 錯誤訊息顯示韓文

#### HTML lang

- [ ] AC 18: Given 使用者將語言設為日文，when 檢查 DOM，then `<html lang="ja">` 且兩個視窗均更新

#### Edge Cases

- [ ] AC 19: Given 使用者在 A 語言下自訂 prompt，when 切到 B 語言再切回 A 語言，then 自訂 prompt 仍完整保留
- [ ] AC 20: Given 前端傳 `language: null` 給 Rust transcribe_audio，then Rust fallback 使用 `"zh"`
- [ ] AC 21: Given 既有中文使用者從 pre-i18n 版本升級，when 系統語言偵測到 `zh-Hant`（Apple 截斷格式），then 正確匹配為 `zh-TW`，Whisper 維持 `"zh"`

## Additional Context

### Dependencies

- `vue-i18n` ^10 — Vue 3 國際化套件（`pnpm add vue-i18n`）
- 無其他新依賴

### Testing Strategy

**單元測試（Vitest）：**

- `tests/unit/i18n-settings.test.ts`（新建）— 10 個測試案例覆蓋語言儲存/載入/偵測/prompt 連動/key 一致性
- `tests/unit/enhancer.test.ts`（修改）— 更新 import + 多語言 prompt + EnhancerApiError 測試
- `tests/unit/use-settings-store.test.ts`（修改）— locale 相關測試

**元件測試（Vitest + Vue Test Utils）：**

- `tests/component/i18n-smoke.test.ts`（新建）— mount View + 切換 locale + 斷言文字切換

**手動測試：**

1. 首次安裝：確認自動偵測系統語言
2. 語言切換：逐一切換 5 種語言，驗證 UI + HUD + 錯誤訊息
3. 語音轉錄：切英文後錄英文語音，確認 Whisper 正確識別且不被幻覺檢測誤殺
4. Prompt 連動：切語言驗證預設 prompt 切換 + 自訂 prompt 保留
5. 持久化：切語言後重啟 app 驗證
6. 跨視窗：Dashboard 切語言驗證 HUD 同步
7. 升級路徑：模擬無 `selectedLocale` 的 settings.json，確認 fallback 行為

### Notes

**高風險項目：**

- 多語言 AI Prompt 品質 — 每種語言的 prompt 都需要實際測試，確保 LLM 正確理解「校對而非對話」指令。特別是日文和韓文的 prompt 可能需要 native speaker 審查。
- 幻覺檢測短語（`HALLUCINATION_PHRASES`）— 目前主要是中英文。切換到日文/韓文後 Whisper 可能產生其他語言的幻覺字串，可後續按需擴充幻覺短語列表。

**已知限制：**

- zh-TW 和 zh-CN 共用 Whisper code `zh`，Whisper 不區分繁簡
- 翻譯檔初期可能不夠完美，但架構支援後續迭代
- Apple 的 `navigator.languages` 可能截斷地區碼，匹配邏輯已處理此情況

**CLAUDE.md 更新提醒：**

實作完成後需更新 CLAUDE.md：
- IPC 契約表：`transcribe_audio` 參數新增 `language: Option<String>`
- 新增 `selectedLocale` 相關設定說明
- 新增 `src/i18n/` 目錄結構說明
