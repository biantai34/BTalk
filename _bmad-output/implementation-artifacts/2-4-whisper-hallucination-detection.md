> **⚠️ 歷史檔案** — 此文件記錄 v0.8.0–v0.8.6 期間的四層幻覺偵測規範，已於 v0.8.7 簡化為二層純物理信號偵測。幻覺字典、自動學習、HallucinationView 等功能已全部移除。當前規範見 `_bmad-output/project-context.md`。

# Story 2.4: Whisper 幻覺偵測與自動學習

Status: done

## Story

As a 使用者,
I want 系統自動偵測並攔截 Whisper 幻覺文字,
So that 沒講話或很短停頓時不會有亂碼被貼入編輯器。

## Acceptance Criteria

1. **AC1: Layer 1 — 語速異常偵測（強判定）**
   - Given 轉錄結果回傳
   - When 錄音時長 < 1 秒且文字 > 10 字（語速異常，物理上不可能）
   - Then 判定為幻覺，不貼上，HUD 顯示「未偵測到語音」
   - And 該文字自動加入 `hallucination_terms` 表（`source: 'auto'`）
   - And HUD 短暫通知「已學習幻覺詞：{text}」（使用獨立 `hallucination:learned` 事件）

2. **AC2: Layer 2 + Layer 3 組合偵測（強判定）**
   - Given 轉錄結果回傳
   - When `noSpeechProbability > 0.9` 且文字完全命中幻覺詞庫（精確匹配或包含匹配）
   - Then 判定為幻覺，不貼上，HUD 顯示「未偵測到語音」

3. **AC3: 雙層弱可疑組合判定**
   - Given 轉錄結果回傳
   - When 兩層弱可疑指標同時成立：`noSpeechProbability > 0.7` 且語速偏高（錄音時長 < 2 秒且文字 > 15 字）
   - Then 判定為幻覺，不貼上，HUD 顯示「未偵測到語音」

4. **AC4: 單層弱可疑放行**
   - Given 轉錄結果回傳
   - When 只有單一層弱可疑指標成立（僅 `noSpeechProbability > 0.7`，或僅語速偏高，但不同時成立）
   - Then 放行，正常貼上

5. **AC5: 多語言內建幻覺詞庫**
   - Given 轉錄語言設定為不同語言
   - When 幻覺偵測 Layer 3 載入內建詞庫
   - Then 根據 `selectedTranscriptionLocale` 載入對應語言的幻覺詞庫
   - And `zh`（含 `zh-TW`、`zh-CN`）載入中文幻覺詞（「謝謝收看」「字幕組」「請訂閱」「感謝觀看」等）
   - And `en` 載入英文幻覺詞（「Thank you for watching」「Subscribe」「Like and share」等）
   - And `ja` 載入日文幻覺詞（「ご視聴ありがとう」「チャンネル登録」等）
   - And `ko` 載入韓文幻覺詞（「시청해 주셔서 감사합니다」「구독」等）
   - And `auto` 載入所有語言的幻覺詞庫（合併）

6. **AC6: 幻覺詞庫管理頁面**
   - Given 幻覺詞庫頁面（`HallucinationView.vue`）
   - When 使用者從側邊欄導航至 `/hallucinations`
   - Then 顯示所有幻覺詞（內建 + 自動學習 + 手動新增），標示來源分類
   - And 使用者可手動新增幻覺詞（`source: 'manual'`）
   - And 使用者可刪除自動學習和手動新增的幻覺詞（內建詞不可刪除）
   - And 頁面頂部顯示幻覺詞總數統計

7. **AC7: HUD 學習通知**
   - Given 幻覺文字被自動加入詞庫
   - When Layer 1 語速異常強判定觸發自動學習
   - Then HUD 短暫播放學習音效（復用 `play_learned_sound`）
   - And HUD 顯示「已學習」通知（復用 `vocabulary:learned` 事件 + NotchHud 現有通知機制）

8. **AC8: 幻覺攔截後的歷史記錄與重送**
   - Given 幻覺偵測判定結果為幻覺
   - When 攔截不貼上
   - Then 仍然寫入 `transcriptions` 表，`status` 為 `failed`（復用 Story 4.4 的 failed 記錄機制）
   - And 錄音檔案仍然保存（復用 Story 4.4 的錄音儲存機制）
   - And 設定 `lastFailedTranscriptionId`、`lastFailedAudioFilePath`、`lastFailedRecordingDurationMs` 重送狀態
   - And 重送按鈕顯示（`canRetry` computed 自動為 true，復用 Story 4.5 的重送機制）

## Tasks / Subtasks

- [x] Task 1: SQLite Migration v4 → v5（AC: #1, #6）
  - [x] 1.1 在 `database.ts` 新增 migration v5（沿用 v4 的 TRANSACTION 模式）
  - [x] 1.2 建立 `hallucination_terms` 表：
    ```sql
    CREATE TABLE IF NOT EXISTS hallucination_terms (
      id TEXT PRIMARY KEY,
      term TEXT NOT NULL UNIQUE,
      source TEXT NOT NULL CHECK(source IN ('builtin', 'auto', 'manual')),
      locale TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    ```
  - [x] 1.3 建立索引：`CREATE INDEX IF NOT EXISTS idx_hallucination_terms_locale ON hallucination_terms(locale);`
  - [x] 1.4 更新 `schema_version` 至 5

- [x] Task 2: 幻覺偵測模組 — `src/lib/hallucinationDetector.ts`（AC: #1, #2, #3, #4）
  - [x] 2.1 建立 `src/lib/hallucinationDetector.ts`，定義 `HallucinationDetectionResult` 型別：
    ```typescript
    export interface HallucinationDetectionResult {
      isHallucination: boolean;
      reason: 'speed-anomaly' | 'high-nsp-term-match' | 'dual-weak-suspicious' | null;
      shouldAutoLearn: boolean;
      detectedText: string;
    }
    ```
  - [x] 2.2 定義常數：
    - `SPEED_ANOMALY_MAX_DURATION_MS = 1000`（Layer 1 錄音時長門檻）
    - `SPEED_ANOMALY_MIN_CHARS = 10`（Layer 1 文字長度門檻）
    - `HIGH_NSP_THRESHOLD = 0.9`（Layer 2 強判定門檻）
    - `WEAK_NSP_THRESHOLD = 0.7`（Layer 2 弱可疑門檻）
    - `WEAK_SPEED_MAX_DURATION_MS = 2000`（弱可疑語速門檻）
    - `WEAK_SPEED_MIN_CHARS = 15`（弱可疑文字長度門檻）
  - [x] 2.3 實作 `detectHallucination(params: { rawText: string; recordingDurationMs: number; noSpeechProbability: number; hallucinationTermList: string[] }): HallucinationDetectionResult`
    - Layer 1：錄音時長 < 1000ms 且文字字數 > 10 → `isHallucination: true, reason: 'speed-anomaly', shouldAutoLearn: true`
    - Layer 2 + 3：`noSpeechProbability > 0.9` 且 `rawText` 命中幻覺詞庫 → `isHallucination: true, reason: 'high-nsp-term-match', shouldAutoLearn: false`
    - 雙弱可疑：`noSpeechProbability > 0.7` 且錄音 < 2000ms 且字數 > 15 → `isHallucination: true, reason: 'dual-weak-suspicious', shouldAutoLearn: false`
    - 其他 → `isHallucination: false, reason: null, shouldAutoLearn: false`
  - [x] 2.4 實作 `matchesHallucinationTermList(text: string, termList: string[]): boolean` — 精確匹配（`text.trim() === term`）或包含匹配（`text.includes(term)`）。包含匹配可能有誤判（如「謝謝大家好」包含「謝謝大家」），但此函式只在 Layer 2+3 中使用（需 `noSpeechProbability > 0.9` 前置條件），實際誤判風險極低

- [x] Task 3: 多語言內建幻覺詞庫 — `src/lib/builtinHallucinationTerms.ts`（AC: #5）
  - [x] 3.1 建立 `src/lib/builtinHallucinationTerms.ts`
  - [x] 3.2 定義 `BUILTIN_HALLUCINATION_TERMS: Record<string, string[]>` — 以 Whisper 語言 code 為 key：
    - `zh`：「謝謝收看」「字幕組」「請訂閱」「感謝觀看」「歡迎訂閱」「謝謝大家」「下期再見」「感謝收聽」「請點讚」等
    - `en`：「Thank you for watching」「Subscribe」「Like and share」「Please subscribe」「Thanks for watching」等
    - `ja`：「ご視聴ありがとう」「チャンネル登録」「ご視聴ありがとうございました」等
    - `ko`：「시청해 주셔서 감사합니다」「구독」「좋아요」等
  - [x] 3.3 實作 `getBuiltinTermListForLocale(transcriptionLocale: TranscriptionLocale): string[]`：
    - `zh-TW` / `zh-CN` → 回傳 `zh` 詞庫
    - `en` → 回傳 `en` 詞庫
    - `ja` → 回傳 `ja` 詞庫
    - `ko` → 回傳 `ko` 詞庫
    - `auto` → 合併所有語言的詞庫並去重

- [x] Task 4: `useHallucinationStore.ts` — Pinia Store（AC: #1, #5, #6）
  - [x] 4.1 建立 `src/stores/useHallucinationStore.ts`，`defineStore('hallucination', () => { ... })`
  - [x] 4.2 定義 `HallucinationTermEntry` 型別：
    ```typescript
    interface HallucinationTermEntry {
      id: string;
      term: string;
      source: 'builtin' | 'auto' | 'manual';
      locale: string;
      createdAt: string;
    }
    ```
  - [x] 4.3 實作 `fetchTermList(): Promise<void>` — 從 SQLite 讀取所有幻覺詞
  - [x] 4.4 實作 `addTerm(term: string, source: 'auto' | 'manual', locale: string): Promise<void>` — 新增幻覺詞至 SQLite（重複時靜默忽略）
  - [x] 4.5 實作 `removeTerm(id: string): Promise<void>` — 刪除幻覺詞（僅允許刪除 `source !== 'builtin'` 的詞）
  - [x] 4.6 實作 `getTermListForDetection(transcriptionLocale: TranscriptionLocale): Promise<string[]>`：
    - 先將 `TranscriptionLocale` 映射為 Whisper language code list（`zh-TW`/`zh-CN` → `['zh']`、`auto` → `['zh', 'en', 'ja', 'ko']`）
    - 從 DB 查詢 `WHERE locale IN (...)` 取得使用者自訂/自動學習的幻覺詞
    - 合併 `getBuiltinTermListForLocale(transcriptionLocale)` 的內建詞庫
    - 回傳去重清單
  - [x] 4.7 實作 `initializeBuiltinTerms(): Promise<void>` — App 啟動時將 `builtinHallucinationTerms.ts` 的內建詞寫入 DB（`INSERT OR IGNORE`），`source: 'builtin'`
  - [x] 4.8 定義 `RawHallucinationTermRow` 介面 + `mapRowToEntry()` 映射函式（snake_case → camelCase）
  - [x] 4.9 expose `termList`, `addTerm`, `removeTerm`, `fetchTermList`, `getTermListForDetection`, `initializeBuiltinTerms`

- [x] Task 5: `useVoiceFlowStore` 整合幻覺偵測（AC: #1, #2, #3, #4, #7, #8）
  - [x] 5.1 在 `stopListeningFlow()` 中，`transcribe_audio` 成功回傳後、`isEmptyTranscription` 檢查之後，新增幻覺偵測邏輯
  - [x] 5.2 呼叫 `hallucinationStore.getTermListForDetection(transcriptionLocale)` 取得幻覺詞清單
  - [x] 5.3 呼叫 `detectHallucination({ rawText, recordingDurationMs, noSpeechProbability, hallucinationTermList })`
  - [x] 5.4 若 `isHallucination === true`：
    - 寫入 `transcriptions` 表，`status: 'failed'`（復用 `buildTranscriptionRecord` + `saveTranscriptionRecord`）
    - 設定重送狀態：`lastFailedTranscriptionId = transcriptionId`、`lastFailedAudioFilePath = audioFilePath`、`lastFailedRecordingDurationMs = recordingDurationMs`（與空轉錄的重送設定邏輯一致）
    - 呼叫 `failRecordingFlow(t('voiceFlow.noSpeechDetected'), ...)`
  - [x] 5.5 若 `shouldAutoLearn === true`（在 5.4 的 return 之前執行）：
    - 取得 Whisper language code：`const whisperCode = settingsStore.getWhisperLanguageCode() ?? 'zh'`（用於 DB 中 locale 欄位）
    - 呼叫 `hallucinationStore.addTerm(rawText.trim(), 'auto', whisperCode)`
    - 發送獨立 `hallucination:learned` 事件通知 HUD（payload: `{ termList: [rawText.trim()] }`）
    - HUD 收到後顯示「已學習幻覺詞」通知文字，與字典學習通知區分
  - [x] 5.6 若 `isHallucination === false`：繼續現有流程（AI 整理 → 貼上）
  - [x] 5.7 在 `handleRetryTranscription()` 中也加入幻覺偵測（重送的轉錄結果同樣需要檢查）

- [x] Task 6: `HallucinationView.vue` — 幻覺詞庫管理頁面（AC: #6）
  - [x] 6.1 建立 `src/views/HallucinationView.vue`
  - [x] 6.2 頁面佈局：
    - 頂部：標題 + 幻覺詞總數統計
    - 新增區域：輸入框 + 新增按鈕（Enter 可新增）
    - 詞庫列表：每筆顯示 `term`、`source` Badge（內建 / 自動學習 / 手動）、`locale`、新增時間
    - 刪除按鈕：`source === 'builtin'` 時 disabled
  - [x] 6.3 使用 shadcn-vue 元件（Badge, Button, Input, Table 等）
  - [x] 6.4 空狀態：「尚無幻覺詞記錄，系統會自動學習 Whisper 常見幻覺文字」
  - [x] 6.5 列表按 `source` 分群（內建 → 自動學習 → 手動）或按時間排序，提供篩選
  - [x] 6.6 `onMounted` 呼叫 `hallucinationStore.fetchTermList()`

- [x] Task 7: Router + Sidebar 新增 `/hallucinations` 路由（AC: #6）
  - [x] 7.1 `src/router.ts` 新增路由：`{ path: "/hallucinations", component: HallucinationView }`
  - [x] 7.2 `src/MainApp.vue` 的 `navItems` 新增幻覺詞庫導航項：
    - `{ path: "/hallucinations", label: t("mainApp.nav.hallucinations"), icon: markRaw(ShieldAlert) }`
    - 位置：在「自訂字典」和「設定」之間
  - [x] 7.3 import `ShieldAlert` from `lucide-vue-next`（或其他語意合適的圖標）

- [x] Task 8: i18n 翻譯鍵新增（AC: #1, #5, #6, #7）
  - [x] 8.1 5 個 locale JSON 新增以下翻譯鍵群：
    - `mainApp.nav.hallucinations`：側邊欄導航項名稱
    - `hallucination.title`：頁面標題
    - `hallucination.totalCount`：「共 {count} 個幻覺詞」
    - `hallucination.addPlaceholder`：輸入框 placeholder
    - `hallucination.addButton`：新增按鈕
    - `hallucination.emptyState`：空狀態提示
    - `hallucination.sourceBuiltin`：「內建」
    - `hallucination.sourceAuto`：「自動學習」
    - `hallucination.sourceManual`：「手動新增」
    - `hallucination.deleteConfirm`：刪除確認
    - `hallucination.duplicateWarning`：「此幻覺詞已存在」
    - `voiceFlow.hallucinationLearned`：「已學習幻覺詞」（HUD 通知用）
  - [x] 8.2 確保 5 個 locale 檔案的 key 結構完全一致

- [x] Task 9: App 啟動初始化內建幻覺詞庫（AC: #5）
  - [x] 9.1 在 `main-window.ts` 的啟動流程中，`initializeDatabase()` 成功後呼叫 `hallucinationStore.initializeBuiltinTerms()`
  - [x] 9.2 HUD 視窗（`App.vue`）不執行 `initializeBuiltinTerms()`（避免雙視窗同時寫入 DB 的競態問題）。HUD 中的 `getTermListForDetection()` 只做讀取，依賴 Dashboard 視窗先完成初始化。若 Dashboard 尚未啟動，`getTermListForDetection()` 仍能正確回傳內建詞庫（因為 `getBuiltinTermListForLocale()` 是純函式，不依賴 DB 中的 builtin 記錄）
  - [x] 9.3 `initializeBuiltinTerms` 使用 `INSERT OR IGNORE` 確保冪等性（重複執行不會新增重複詞）

- [ ] Task 10: 手動測試驗證（AC: #1-#8）
  - [ ] 10.1 驗證短錄音（< 1 秒）產生長文字時被攔截
  - [ ] 10.2 驗證高 noSpeechProbability + 命中幻覺詞時被攔截
  - [ ] 10.3 驗證雙弱可疑組合被攔截
  - [ ] 10.4 驗證單弱可疑正常放行
  - [ ] 10.5 驗證自動學習後幻覺詞出現在幻覺詞庫頁面
  - [ ] 10.6 驗證 HUD 顯示學習通知
  - [ ] 10.7 驗證攔截後重送按鈕可用
  - [ ] 10.8 驗證幻覺詞庫頁面 CRUD 操作正常
  - [ ] 10.9 驗證切換轉錄語言後，內建詞庫正確切換

### Review Follow-ups (AI)

- [ ] [AI-Review][HIGH] F1: HallucinationView.vue handleAddTerm() locale 硬編碼為 "zh"，應從 settingsStore.getWhisperLanguageCode() 取得 [src/views/HallucinationView.vue:56]
- [ ] [AI-Review][HIGH] F2: handleRetryTranscription 幻覺攔截後使用 transitionTo 而非 failRecordingFlow，可能導致 HUD autoHide 行為不一致 [src/stores/useVoiceFlowStore.ts:1207-1214]
- [ ] [AI-Review][MEDIUM] F3: initializeBuiltinTerms 逐筆 INSERT 36 次 IPC 呼叫，建議包 TRANSACTION 或先檢查是否已初始化 [src/stores/useHallucinationStore.ts:169-179]
- [ ] [AI-Review][MEDIUM] F4: matchesHallucinationTermList 英文比對 case-sensitive，Whisper 英文輸出大小寫不穩定可能導致漏命中 [src/lib/hallucinationDetector.ts:51-58]
- [ ] [AI-Review][MEDIUM] F5: hallucination.title i18n key 已定義但未使用（dead key） [src/views/HallucinationView.vue + 5 locale JSON]
- [ ] [AI-Review][MEDIUM] F6: AC7 文字自相矛盾（同時提到「獨立事件」和「復用 vocabulary:learned」），需更正 Story 規格 [story AC7]
- [ ] [AI-Review][LOW] F7: HallucinationView.vue 錯誤/載入訊息復用 dictionary.* 翻譯鍵，應新增 hallucination.loadFailed / hallucination.loading [src/views/HallucinationView.vue:95,160]
- [ ] [AI-Review][LOW] F8: 測試缺少 edge case：recordingDurationMs=0、noSpeechProbability 超出 0-1 範圍 [tests/unit/hallucination-detector.test.ts]

## Dev Notes

### 架構模式與約束

**Brownfield 專案** — 基於 Story 2.3（品質監控）及 Story 4.4/4.5（錄音儲存 + 重送）繼續擴展。本 Story 是 sprint change proposal 中問題 1 的實作，為 v0.9.0 核心功能。

**前置 Story 已完成的前提：**
- Story 4.4：`transcriptions` 表有 `audio_file_path` 和 `status` 欄位，`save_recording_file` Command 已實作
- Story 4.5：`retranscribe_from_file` Command、重送狀態（`lastFailed*`）、`canRetry` computed、`handleRetryTranscription()` 已實作
- `TranscriptionResult` 已包含 `noSpeechProbability` 欄位（`src/types/audio.ts`）

**本 Story 的核心架構變更：**
1. 新增 SQLite `hallucination_terms` 表（Migration v5）
2. 新增 `hallucinationDetector.ts` — 純邏輯偵測模組（`lib/` 層）
3. 新增 `builtinHallucinationTerms.ts` — 多語言內建詞庫（`lib/` 層）
4. 新增 `useHallucinationStore.ts` — 幻覺詞庫 CRUD Store
5. 新增 `HallucinationView.vue` — 幻覺詞庫管理頁面
6. 修改 `useVoiceFlowStore.ts` — 整合幻覺偵測流程
7. 修改 `router.ts` + `MainApp.vue` — 新增路由和導航

**依賴方向規則（嚴格遵守）：**
```
views/HallucinationView.vue → stores/useHallucinationStore.ts → lib/database.ts
stores/useVoiceFlowStore.ts → lib/hallucinationDetector.ts（純邏輯）
stores/useVoiceFlowStore.ts → stores/useHallucinationStore.ts（取詞庫清單）
lib/hallucinationDetector.ts → 無外部依賴（純函式）
lib/builtinHallucinationTerms.ts → 無外部依賴（常數 + 純函式）
```

**禁止：**
- views/ 不可直接 import `hallucinationDetector.ts`（必須透過 store）
- 元件不可直接執行 SQL
- 不使用 Tailwind 原生色彩
- 不硬編碼使用者可見字串（全部走 i18n）

### 三層偵測邏輯流程圖

```
 transcribe_audio() 回傳 TranscriptionResult
       │
       ▼
 isEmptyTranscription(rawText)?
       │
   ┌───┤
   │   │ true → 既有的空轉錄流程（不變）
   │   │
   │   │ false ↓
   │   │
   │   ▼
   │ detectHallucination({
   │   rawText, recordingDurationMs,
   │   noSpeechProbability, hallucinationTermList
   │ })
   │   │
   │   ▼
   │ ┌──── Layer 1: 語速異常？ ────────────────────────┐
   │ │ recordingDurationMs < 1000 && chars > 10         │
   │ │     → 強判定幻覺 + 自動學習                       │
   │ └──────────────────────────────────────────────────┘
   │   │ no
   │   ▼
   │ ┌──── Layer 2+3: 高 NSP + 詞庫命中？ ──────────────┐
   │ │ noSpeechProbability > 0.9 && matchesTermList()    │
   │ │     → 強判定幻覺（不學習，已知詞）                  │
   │ └──────────────────────────────────────────────────┘
   │   │ no
   │   ▼
   │ ┌──── 雙弱可疑？ ─────────────────────────────────┐
   │ │ noSpeechProbability > 0.7 &&                     │
   │ │ recordingDurationMs < 2000 && chars > 15          │
   │ │     → 組合判定幻覺                                │
   │ └──────────────────────────────────────────────────┘
   │   │ no
   │   ▼
   │ 放行：進入正常 AI 整理 → 貼上流程
   │
   └── (空轉錄既有流程)
```

### `hallucination_terms` 表設計

| 欄位 | 型別 | 說明 |
|------|------|------|
| `id` | `TEXT PRIMARY KEY` | UUID（前端 `crypto.randomUUID()`） |
| `term` | `TEXT NOT NULL UNIQUE` | 幻覺詞文字 |
| `source` | `TEXT NOT NULL` | `'builtin'` / `'auto'` / `'manual'` |
| `locale` | `TEXT NOT NULL` | 對應語言（`zh` / `en` / `ja` / `ko`） |
| `created_at` | `TEXT DEFAULT datetime('now')` | 建立時間 |

**與 `vocabulary` 表分開**的原因：語意不同（幻覺詞是「要排除的」，字典詞是「要保留的」），混用會增加查詢複雜度。

**UNIQUE 約束設計決策**：`term TEXT NOT NULL UNIQUE` 表示同一文字全域唯一，不區分 locale。理由：幻覺詞的本質是「不管哪個語言設定，只要出現就可疑」——例如使用者 `auto` 模式下自動學習了「谢谢大家」，之後切到 `zh-TW` 也應該能命中。若需要同文字多 locale 的場景（極少），可改為 `UNIQUE(term, locale)` 複合唯一。（**待確認**：見 Review Finding F2）

### hallucinationDetector.ts 設計

**純函式模組**：不依賴 Vue/Pinia/Tauri，可單獨測試。

```typescript
// hallucinationDetector.ts — 核心偵測邏輯

export interface HallucinationDetectionParams {
  rawText: string;
  recordingDurationMs: number;
  noSpeechProbability: number;
  hallucinationTermList: string[];
}

export interface HallucinationDetectionResult {
  isHallucination: boolean;
  reason: 'speed-anomaly' | 'high-nsp-term-match' | 'dual-weak-suspicious' | null;
  shouldAutoLearn: boolean;
  detectedText: string;
}

export function detectHallucination(
  params: HallucinationDetectionParams
): HallucinationDetectionResult {
  const { rawText, recordingDurationMs, noSpeechProbability, hallucinationTermList } = params;
  const trimmedText = rawText.trim();
  const charCount = trimmedText.length;

  // Layer 1: 語速異常（物理定律級判斷）
  if (recordingDurationMs < SPEED_ANOMALY_MAX_DURATION_MS && charCount > SPEED_ANOMALY_MIN_CHARS) {
    return {
      isHallucination: true,
      reason: 'speed-anomaly',
      shouldAutoLearn: true,
      detectedText: trimmedText,
    };
  }

  // Layer 2 + 3: 高 NSP + 詞庫命中
  if (noSpeechProbability > HIGH_NSP_THRESHOLD
      && matchesHallucinationTermList(trimmedText, hallucinationTermList)) {
    return {
      isHallucination: true,
      reason: 'high-nsp-term-match',
      shouldAutoLearn: false,
      detectedText: trimmedText,
    };
  }

  // 雙弱可疑組合
  const isWeakNsp = noSpeechProbability > WEAK_NSP_THRESHOLD;
  const isWeakSpeed = recordingDurationMs < WEAK_SPEED_MAX_DURATION_MS
                      && charCount > WEAK_SPEED_MIN_CHARS;
  if (isWeakNsp && isWeakSpeed) {
    return {
      isHallucination: true,
      reason: 'dual-weak-suspicious',
      shouldAutoLearn: false,
      detectedText: trimmedText,
    };
  }

  // 放行
  return {
    isHallucination: false,
    reason: null,
    shouldAutoLearn: false,
    detectedText: trimmedText,
  };
}
```

### useVoiceFlowStore 修改策略

**插入點**：在 `isEmptyTranscription(result.rawText)` 判定為 false 之後、AI 整理分支之前。

```
 isEmptyTranscription(result.rawText)?
       │
       │ false
       ▼
 ┌─ 新增：幻覺偵測 ─────────────────────┐
 │ const hallucinationTermList =           │
 │   await hallucinationStore              │
 │     .getTermListForDetection(locale)    │
 │                                         │
 │ const detection = detectHallucination({ │
 │   rawText, recordingDurationMs,         │
 │   noSpeechProbability,                  │
 │   hallucinationTermList                 │
 │ })                                      │
 │                                         │
 │ if (detection.isHallucination) {        │
 │   // 寫 failed 記錄 + 設重送 + 自動學習│
 │   return;                               │
 │ }                                       │
 └─────────────────────────────────────────┘
       │
       ▼
 既有 AI 整理 → 貼上流程（不變）
```

**需修改的路徑**：
1. `stopListeningFlow()` — 主流程
2. `handleRetryTranscription()` — 重送流程（也需要幻覺偵測）

**注意**：幻覺偵測是在非空轉錄結果上額外篩選。空轉錄（`isEmptyTranscription`）仍走既有流程，兩者互不干擾。

### useHallucinationStore SQL 操作

```typescript
const FETCH_ALL_SQL = `
  SELECT id, term, source, locale, created_at
  FROM hallucination_terms
  ORDER BY source ASC, created_at DESC
`;

const INSERT_TERM_SQL = `
  INSERT OR IGNORE INTO hallucination_terms (id, term, source, locale)
  VALUES ($1, $2, $3, $4)
`;

const DELETE_TERM_SQL = `
  DELETE FROM hallucination_terms WHERE id = $1 AND source != 'builtin'
`;

const FETCH_BY_LOCALE_SQL = `
  SELECT term FROM hallucination_terms
  WHERE locale IN ($1)
`;
// 注意：auto 模式時需動態構建 WHERE locale IN ('zh', 'en', 'ja', 'ko')
// 或分次查詢後合併，避免 SQL injection（tauri-plugin-sql 參數化不支援 IN 陣列）
```

### HallucinationView.vue 佈局

```
┌─────────────────────────────────────────────────┐
│ 幻覺詞庫管理              共 42 個幻覺詞         │
│                                                  │
│ ┌──────────────────────────────┐ ┌──────┐       │
│ │ 輸入新的幻覺詞...             │ │ 新增 │       │
│ └──────────────────────────────┘ └──────┘       │
│                                                  │
│ ┌────────────────────────────────────────────┐  │
│ │ 詞彙              來源       語言   操作   │  │
│ ├────────────────────────────────────────────┤  │
│ │ 謝謝收看          [內建]     zh     —      │  │
│ │ Thank you for...  [內建]     en     —      │  │
│ │ 字幕由Amara提供   [自動學習]  zh     [刪除] │  │
│ │ 請訂閱我的頻道     [手動]     zh     [刪除] │  │
│ └────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

### 跨 Story 備註

- **Story 4.4**（前置，已完成）：`status: 'failed'` 記錄機制、`save_recording_file` Command
- **Story 4.5**（前置，已完成）：`retranscribe_from_file`、重送狀態、`canRetry` computed
- **Story 2.2**（已完成）：Whisper prompt + AI 整理 prompt（幻覺偵測不影響 prompt 邏輯）
- **Story 2.3**（已完成）：品質監控在成功貼上後才啟動，幻覺攔截不觸發品質監控
- **v0.7.3 幻聽策略修正**：目前 `isEmptyTranscription()` 只攔截完全空白。本 Story 新增的幻覺偵測是「非空白但可疑」的第二層過濾，兩者互補而非替代

### 不需修改的 Rust 端

- **`TranscriptionResult`** 已包含 `noSpeechProbability`（`src/types/audio.ts`）
- **`StopRecordingResult`** 已包含 `recordingDurationMs`
- **幻覺偵測完全在前端 TypeScript 層完成**，不需新增 Rust Command
- 理由：所有需要的資料（rawText、recordingDurationMs、noSpeechProbability）在前端已可取得

### 需要修改的檔案清單

| 檔案 | 修改範圍 |
|------|---------|
| `src/lib/database.ts` | Migration v4 → v5（`hallucination_terms` 表） |
| `src/lib/hallucinationDetector.ts` | **新增** — 純函式幻覺偵測模組 |
| `src/lib/builtinHallucinationTerms.ts` | **新增** — 多語言內建幻覺詞庫 |
| `src/stores/useHallucinationStore.ts` | **新增** — 幻覺詞庫 CRUD Store |
| `src/views/HallucinationView.vue` | **新增** — 幻覺詞庫管理頁面 |
| `src/stores/useVoiceFlowStore.ts` | 整合幻覺偵測（`stopListeningFlow` + `handleRetryTranscription`） |
| `src/router.ts` | 新增 `/hallucinations` 路由 |
| `src/MainApp.vue` | `navItems` 新增幻覺詞庫導航項 |
| `src/main-window.ts` | 啟動時初始化內建幻覺詞庫 |
| `src/App.vue` | 不需修改（HUD 不執行 `initializeBuiltinTerms`，`getTermListForDetection` 只讀取） |
| `src/i18n/locales/zh-TW.json` | 新增翻譯鍵 |
| `src/i18n/locales/en.json` | 新增翻譯鍵 |
| `src/i18n/locales/ja.json` | 新增翻譯鍵 |
| `src/i18n/locales/zh-CN.json` | 新增翻譯鍵 |
| `src/i18n/locales/ko.json` | 新增翻譯鍵 |

### 不需修改的檔案（明確排除）

- `src-tauri/src/plugins/transcription.rs` — Rust 端不變，前端消費既有 `TranscriptionResult`
- `src-tauri/src/plugins/audio_recorder.rs` — 錄音邏輯不變
- `src-tauri/src/lib.rs` — 不需新增 Rust Command
- `src-tauri/Cargo.toml` — 不需新增 Rust 依賴
- `src/lib/enhancer.ts` — AI 整理邏輯不變
- `src/stores/useHistoryStore.ts` — 歷史 store 不變（復用既有的 `addTranscription`）
- `src/stores/useSettingsStore.ts` — 設定 store 不變
- `src/stores/useVocabularyStore.ts` — 字典 store 不變
- `src/views/SettingsView.vue` — 設定頁面不變
- `src/components/NotchHud.vue` — HUD 已有 `vocabulary:learned` 學習通知機制，直接復用
- `package.json` — 不需新增 JS 依賴

### 效能注意事項

- `detectHallucination()` 是同步純函式，計算量極低（字串比對 + 數值比較）
- `getTermListForDetection()` 涉及 SQLite 查詢，但詞庫量小（< 100 筆），查詢 < 10ms
- 幻覺偵測在每次轉錄結束後執行，不影響錄音/轉錄效能
- 內建詞庫初始化（`initializeBuiltinTerms`）使用 `INSERT OR IGNORE`，App 啟動時僅新增缺失項目

### 安全規則提醒

- 幻覺詞庫不包含任何個人資訊
- 幻覺偵測結果不上傳至任何外部服務
- 幻覺詞庫僅存於本地 SQLite

### References

- [Source: _bmad-output/planning-artifacts/sprint-change-proposal-2026-03-15.md#問題 1] — 三層幻覺偵測架構決策、影響範圍分析
- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.4] — AC 完整定義（lines 563-600）
- [Source: _bmad-output/planning-artifacts/epics.md#Epic 2 描述] — 幻覺偵測功能定位
- [Source: _bmad-output/project-context.md#幻覺檢測策略] — v0.7.3 修正：`isEmptyTranscription()` 只攔截完全空白
- [Source: _bmad-output/implementation-artifacts/4-4-recording-storage-history-playback.md] — 前置 Story：`audio_file_path`、`status` 欄位、`save_recording_file`
- [Source: _bmad-output/implementation-artifacts/4-5-transcription-retry-from-disk.md] — 前置 Story：`retranscribe_from_file`、重送機制
- [Source: src/types/audio.ts] — `TranscriptionResult.noSpeechProbability`（已存在）
- [Source: src/stores/useVoiceFlowStore.ts] — 現有 `isEmptyTranscription()`、`stopListeningFlow()`、`handleRetryTranscription()`
- [Source: src/lib/database.ts] — 現有 schema version 4、migration 模式
- [Source: src/composables/useTauriEvents.ts] — `VOCABULARY_LEARNED` 事件常數（復用）
- [Source: src/components/NotchHud.vue] — 現有學習通知機制（`vocabulary:learned` event handler）
- [Source: src/router.ts] — 現有路由定義
- [Source: src/MainApp.vue] — 現有 `navItems` 和 Sidebar 結構
- [Source: src/i18n/languageConfig.ts] — `TranscriptionLocale` 型別

## Dev Agent Record

### 2026-03-15 實作記錄

**完成 Task 1-9（Task 10 為手動測試）**

#### 新增檔案
| 檔案 | 說明 |
|------|------|
| `src/lib/hallucinationDetector.ts` | 純函式三層幻覺偵測模組 |
| `src/lib/builtinHallucinationTerms.ts` | 多語言內建幻覺詞庫（zh/en/ja/ko） |
| `src/stores/useHallucinationStore.ts` | 幻覺詞庫 CRUD Pinia Store |
| `src/views/HallucinationView.vue` | 幻覺詞庫管理頁面（shadcn-vue） |
| `tests/unit/hallucination-detector.test.ts` | hallucinationDetector 單元測試（22 tests） |
| `tests/unit/builtin-hallucination-terms.test.ts` | builtinHallucinationTerms 單元測試（11 tests） |

#### 修改檔案
| 檔案 | 修改範圍 |
|------|---------|
| `src/lib/database.ts` | Migration v4 → v5（hallucination_terms 表 + locale 索引） |
| `src/stores/useVoiceFlowStore.ts` | 整合幻覺偵測（handleStopRecording + handleRetryTranscription） |
| `src/composables/useTauriEvents.ts` | 新增 `HALLUCINATION_LEARNED` 事件常量 |
| `src/types/events.ts` | 新增 `HallucinationLearnedPayload` 型別 |
| `src/components/NotchHud.vue` | 監聽 `hallucination:learned` 事件，顯示獨立通知 |
| `src/router.ts` | 新增 `/hallucinations` 路由 |
| `src/MainApp.vue` | navItems 新增幻覺詞庫導航項（ShieldAlert icon） |
| `src/main-window.ts` | 啟動時初始化內建幻覺詞庫 |
| `src/i18n/locales/zh-TW.json` | 新增 hallucination.* + voiceFlow.hallucination* 翻譯鍵 |
| `src/i18n/locales/en.json` | 同上 |
| `src/i18n/locales/ja.json` | 同上 |
| `src/i18n/locales/zh-CN.json` | 同上 |
| `src/i18n/locales/ko.json` | 同上 |

#### 測試結果
- 全部 335 tests 通過（18 test files）
- TypeScript 型別檢查通過（vue-tsc --noEmit）
- 新增 33 個測試覆蓋 hallucinationDetector + builtinHallucinationTerms

#### 設計決策
- `hallucination:learned` 使用獨立事件（不復用 `vocabulary:learned`），NotchHud 顯示「已學習幻覺詞」標籤
- `hallucination_terms.term` 使用 UNIQUE(term) 全域唯一
- 幻覺攔截觸發重送（設定 lastFailed* 狀態啟用 canRetry）
- `getTermListForDetection()` DB 查詢失敗時仍回傳內建詞庫（graceful degradation）
