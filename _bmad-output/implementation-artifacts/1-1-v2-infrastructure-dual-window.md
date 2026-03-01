# Story 1.1: V2 基礎架構與雙視窗設置

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 開發者,
I want V2 所需的基礎架構（依賴、資料庫、狀態管理、雙視窗、路由）全部就緒,
So that 後續所有功能開發都能在穩定的架構基礎上進行。

## Acceptance Criteria

1. **Rust 依賴安裝** — Cargo.toml 包含所有 V2 新增依賴（rdev 0.5.3, tauri-plugin-sql 2.3.1, tauri-plugin-autostart 2.5.1, tauri-plugin-updater ~2.2.0, tauri-plugin-store ~2.4）且 `cargo check` 通過。tauri.conf.json plugins 區塊正確註冊所有新 plugin。

2. **JS 依賴安裝** — package.json 包含所有 V2 新增依賴（vue-router 5.0.3, pinia 3.x, @tauri-apps/plugin-sql, @tauri-apps/plugin-autostart, @tauri-apps/plugin-updater, @tauri-apps/plugin-store）且 `pnpm install` 無錯誤。

3. **SQLite 初始化** — App 啟動時執行 database.ts 初始化邏輯，在 App Data 目錄建立 SQLite 資料庫，包含 transcriptions、vocabulary、schema_version 三張表，使用 WAL 模式，schema_version 記錄版本號。

4. **Pinia Stores 骨架** — 四個 store 檔案存在於 src/stores/（useSettingsStore, useHistoryStore, useVocabularyStore, useVoiceFlowStore），每個使用 defineStore 正確定義，Pinia 在 main.ts 和 main-window.ts 中正確初始化。

5. **雙視窗配置** — tauri.conf.json 定義 HUD Window（維持現有配置）+ Main Window（標準視窗，從 main-window.html 載入）。Vite 配置新增 main-window.html 作為額外入口點。

6. **Main Window 檔案建立** — MainApp.vue 包含左側 Sidebar 導航（Dashboard / 歷史 / 字典 / 設定）與右側內容區域。Vue Router hash mode 配置四個路由（/dashboard, /history, /dictionary, /settings）。每個 View 元件存在作為空白佔位。

7. **Tauri Events 封裝** — useTauriEvents.ts 提供 emitToWindow / listenToEvent 封裝方法，事件命名遵循 {domain}:{action} kebab-case。

## Tasks / Subtasks

- [x] Task 1: 安裝 V2 Rust 依賴 (AC: #1)
  - [x] 1.1 在 Cargo.toml 新增 rdev = "0.5.3"
  - [x] 1.2 在 Cargo.toml 新增 tauri-plugin-sql = { version = "2.3.1", features = ["sqlite"] }
  - [x] 1.3 在 Cargo.toml 新增 tauri-plugin-autostart = "2.5.1"
  - [x] 1.4 在 Cargo.toml 新增 tauri-plugin-updater = "~2.2.0"
  - [x] 1.5 在 Cargo.toml 新增 tauri-plugin-store = "~2.4"
  - [x] 1.6 在 lib.rs 中註冊所有新 plugin（.plugin(tauri_plugin_sql::Builder::default().build()) 等）
  - [x] 1.7 在 tauri.conf.json plugins 區塊新增需要配置的 plugin（注意：sql 和 store 使用 programmatic API 不需 conf 配置，autostart 需要配置 macOS launcher type）
  - [x] 1.8 在 capabilities/default.json：(a) 將 `"windows"` 改為 `["main", "main-window"]` 讓兩個視窗都有權限；(b) 新增權限：`"sql:default"`, `"store:default"`, `"core:event:allow-emit-to"`
  - [x] 1.9 執行 `cargo check` 確認編譯通過

- [x] Task 2: 安裝 V2 JS 依賴 (AC: #2)
  - [x] 2.1 `pnpm add vue-router@5.0.3 pinia@3`
  - [x] 2.2 `pnpm add @tauri-apps/plugin-sql @tauri-apps/plugin-autostart @tauri-apps/plugin-updater @tauri-apps/plugin-store`
  - [x] 2.3 確認 `pnpm install` 無錯誤、無 peer dependency 警告

- [x] Task 3: SQLite 資料庫初始化 (AC: #3)
  - [x] 3.1 建立 src/lib/database.ts
  - [x] 3.2 實作 initializeDatabase() — 使用 @tauri-apps/plugin-sql 的 Database.load('sqlite:app.db')，使用 singleton pattern export db instance（`let db: Database | null = null`，initializeDatabase 回傳已初始化的 instance，後續 import 使用 `getDatabase()` 取得）
  - [x] 3.3 連線後執行 `PRAGMA journal_mode = WAL;` 和 `PRAGMA synchronous = NORMAL;`
  - [x] 3.4 建立 transcriptions 表（完整 schema 見 Dev Notes）
  - [x] 3.5 建立 vocabulary 表
  - [x] 3.6 建立 schema_version 表並插入初始版本 1
  - [x] 3.7 建立索引 idx_transcriptions_timestamp 和 idx_transcriptions_created_at

- [x] Task 4: Pinia Stores 骨架 (AC: #4)
  - [x] 4.1 建立 src/stores/ 目錄
  - [x] 4.2 建立 useSettingsStore.ts — state: hotkeyConfig (null), triggerMode ('hold'), hasApiKey (false), aiPrompt (''); actions: loadSettings(), saveSettings()
  - [x] 4.3 建立 useHistoryStore.ts — state: transcriptionList ([]), isLoading (false); actions: fetchTranscriptionList(), addTranscription(), calculateDashboardStats()
  - [x] 4.4 建立 useVocabularyStore.ts — state: termList ([]), isLoading (false); actions: fetchTermList(), addTerm(), removeTerm()
  - [x] 4.5 建立 useVoiceFlowStore.ts — state: status ('idle' as HudStatus), message (''); actions: transitionTo()
  - [x] 4.6 在 main.ts 初始化 Pinia：createPinia() + app.use(pinia)
  - [x] 4.7 在 main-window.ts 初始化 Pinia（與 main.ts 獨立 instance）

- [x] Task 5: 雙視窗配置 (AC: #5)
  - [x] 5.1 建立 main-window.html（專案根目錄，參考 index.html 結構，掛載點 #app，script src 指向 src/main-window.ts）
  - [x] 5.2 在 tauri.conf.json app.windows 新增第二個視窗定義 label: "main-window"
  - [x] 5.3 在 vite.config.ts 的 build.rollupOptions.input 新增 main-window.html 入口
  - [x] 5.4 HUD Window（label: "main"）維持現有配置不變
  - [x] 5.5 Main Window 配置：visible: false（預設隱藏，由 Tray 開啟）、decorations: true、resizable: true、width: 960、height: 680、title: "NoWayLM Voice - Dashboard"（與 HUD 區分）

- [x] Task 6: Main Window 入口與路由 (AC: #6)
  - [x] 6.1 建立 src/main-window.ts — `import './style.css'` + `await initializeDatabase()` + createApp(MainApp) + use(pinia) + use(router) + mount('#app')。注意：必須 import style.css 否則無 Tailwind 樣式；必須在 mount 前呼叫 initializeDatabase() 確保 SQLite 就緒
  - [x] 6.2 建立 src/MainApp.vue — 左側 Sidebar 導航 + 右側 <router-view>
  - [x] 6.3 建立 src/router.ts — createRouter hash mode，四個路由定義 + `{ path: '/', redirect: '/dashboard' }` 作為預設路由
  - [x] 6.4 建立 src/views/DashboardView.vue（空白佔位，標題 "Dashboard"）
  - [x] 6.5 建立 src/views/HistoryView.vue（空白佔位）
  - [x] 6.6 建立 src/views/DictionaryView.vue（空白佔位）
  - [x] 6.7 建立 src/views/SettingsView.vue（空白佔位）
  - [x] 6.8 Sidebar 使用 Tailwind CSS，包含 App 名稱/Logo + 四個導航項目 + active 狀態高亮

- [x] Task 7: Tauri Events 跨視窗通訊封裝 (AC: #7)
  - [x] 7.1 建立 src/composables/useTauriEvents.ts
  - [x] 7.2 Re-export Tauri `emitTo` 為 `emitToWindow`，保留原始 Tauri API 簽名
  - [x] 7.3 Re-export Tauri `listen` 為 `listenToEvent`，保留原始 Tauri API 簽名（handler 接收 `Event<T>`，消費者透過 `event.payload` 取值）
  - [x] 7.4 定義事件常數：VOICE_FLOW_STATE_CHANGED, TRANSCRIPTION_COMPLETED, SETTINGS_UPDATED, VOCABULARY_CHANGED

- [x] Task 8: 型別定義擴展 (AC: #4, #7)
  - [x] 8.1 擴展 src/types/index.ts — 新增 'enhancing' 到 HudStatus union type
  - [x] 8.2 建立 src/types/transcription.ts — TranscriptionRecord, DashboardStats 介面
  - [x] 8.3 建立 src/types/vocabulary.ts — VocabularyEntry 介面
  - [x] 8.4 建立 src/types/settings.ts — SettingsDto, HotkeyConfig 介面
  - [x] 8.5 建立 src/types/events.ts — Tauri Event payload 型別定義

- [x] Task 9: 整合驗證 (AC: #1-7)
  - [x] 9.1 `cargo check` 通過
  - [x] 9.2 Vite build 通過，雙入口打包成功（runtime 驗證需 GUI 環境手動執行 `pnpm tauri dev`）
  - [x] 9.3 HUD Window 配置未被修改，行為不受影響
  - [x] 9.4 Main Window 配置完成，Sidebar + Router 就緒（runtime 驗證需手動）
  - [x] 9.5 SQLite 初始化邏輯完整（runtime 驗證需手動）
  - [x] 9.6 Pinia stores 在兩個入口各自獨立初始化

## Dev Notes

### 架構模式與約束

**這是 Brownfield 專案** — 基於已完成的 POC 擴展，不需要 `npm init` 或 `cargo init`。所有修改都是在現有結構上新增。

**依賴方向規則（嚴格遵守）：**
```
views/ → components/ + stores/ + composables/
stores/ → lib/
lib/ → 外部 API（Groq）
composables/ → stores/ + lib/
```
禁止 views/ 直接呼叫 lib/，必須透過 store。

**錯誤處理模式：**
- Service 層（lib/）拋出有意義錯誤
- Store 層 catch + 降級 + 使用者提示
- 不建立統一錯誤碼系統

### SQLite Schema（必須完全按照此 schema 建立）

```sql
-- 歷史記錄
CREATE TABLE IF NOT EXISTS transcriptions (
  id TEXT PRIMARY KEY,
  timestamp INTEGER NOT NULL,
  raw_text TEXT NOT NULL,
  processed_text TEXT,
  recording_duration_ms INTEGER NOT NULL,
  transcription_duration_ms INTEGER NOT NULL,
  enhancement_duration_ms INTEGER,
  char_count INTEGER NOT NULL,
  trigger_mode TEXT NOT NULL CHECK(trigger_mode IN ('hold', 'toggle')),
  was_enhanced INTEGER NOT NULL DEFAULT 0,
  was_modified INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_transcriptions_timestamp ON transcriptions(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_transcriptions_created_at ON transcriptions(created_at);

-- 自訂詞彙
CREATE TABLE IF NOT EXISTS vocabulary (
  id TEXT PRIMARY KEY,
  term TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Schema 版本追蹤
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY
);

INSERT OR IGNORE INTO schema_version (version) VALUES (1);
```

### Pinia Store 定義規則

- Store ID 使用 kebab-case：`defineStore('settings', ...)`、`defineStore('history', ...)`
- 每個 store 各自管理 `isLoading: boolean`，不使用全域 loading
- CRUD action 命名：`addXxx()`, `removeXxx()`, `updateXxx()`, `fetchXxxList()`
- 查詢命名：`getXxxById()`, `searchXxx()`
- 計算命名：`calculateDashboardStats()`
- SQLite snake_case → TypeScript camelCase 映射在 store action 中處理

### 雙視窗架構細節

**HUD Window (label: "main")** — 維持現有配置：
- 置頂、透明、不可互動、400×100px、y=0
- 載入 index.html → main.ts → App.vue

**Main Window (label: "main-window")** — 新增：
- 標準視窗、960×680px、預設隱藏
- 載入 main-window.html → main-window.ts → MainApp.vue
- 配置：`{ visible: false, decorations: true, resizable: true, center: true, title: "NoWayLM Voice - Dashboard" }`

**Vite 多入口配置：**
```typescript
build: {
  rollupOptions: {
    input: {
      main: resolve(__dirname, 'index.html'),
      'main-window': resolve(__dirname, 'main-window.html'),
    },
  },
}
```

**tauri.conf.json 第二視窗定義：**
```json
{
  "label": "main-window",
  "title": "NoWayLM Voice - Dashboard",
  "url": "main-window.html",
  "width": 960,
  "height": 680,
  "visible": false,
  "decorations": true,
  "resizable": true,
  "center": true,
  "minWidth": 720,
  "minHeight": 480
}
```

### Tauri Events 命名規範

事件名必須遵循 `{domain}:{action}` kebab-case：

| Event Name | Direction | Payload |
|------------|-----------|---------|
| `voice-flow:state-changed` | HUD ← VoiceFlow | `{ status, message }` |
| `transcription:completed` | → Main Window | `{ id, rawText, processedText, ... }` |
| `settings:updated` | → All Windows | `{ key, value }` |
| `vocabulary:changed` | → All Windows | `{ action, term }` |

### tauri-plugin-sql WAL Mode 啟用方式

tauri-plugin-sql **不內建 WAL mode 設定**。必須在連線後手動執行：

```typescript
import Database from '@tauri-apps/plugin-sql';

const db = await Database.load('sqlite:app.db');
await db.execute('PRAGMA journal_mode = WAL;');
await db.execute('PRAGMA synchronous = NORMAL;');
```

### Plugin 註冊順序（lib.rs）

在 `tauri::Builder::default()` 鏈中註冊：

```rust
.plugin(tauri_plugin_sql::Builder::default().build())
.plugin(tauri_plugin_store::Builder::default().build())
.plugin(tauri_plugin_autostart::init(
    tauri_plugin_autostart::MacosLauncher::LaunchAgent, None
))
.plugin(tauri_plugin_updater::Builder::new().build())
```

### 命名規範速查

| 類型 | 慣例 | 範例 |
|------|------|------|
| Rust functions | snake_case | `paste_text()`, `listen_hotkey()` |
| Rust types | PascalCase | `TranscriptionRecord`, `HotkeyConfig` |
| TS variables/functions | camelCase | `addTranscription()`, `enhancedText` |
| TS types/interfaces | PascalCase + 後綴 | `SettingsDto`, `VoiceFlowState` |
| TS boolean | is/has/can/should | `isRecording`, `wasEnhanced`, `hasApiKey` |
| TS constants | UPPER_SNAKE_CASE | `DEFAULT_PROMPT`, `API_TIMEOUT_MS` |
| Vue components | PascalCase | `NotchHud.vue`, `DashboardView.vue` |
| Pinia store files | camelCase | `useSettingsStore.ts` |
| Pinia store ID | kebab-case | `defineStore('settings', ...)` |
| Tauri events | {domain}:{action} kebab | `voice-flow:state-changed` |
| SQLite columns | snake_case | `raw_text`, `recording_duration_ms` |
| Folders | kebab-case | `src/stores/`, `src/views/` |

### Project Structure Notes

**新增檔案清單（本 Story 產出）：**
```
src/
├── stores/                    [新增目錄]
│   ├── useSettingsStore.ts   [新增]
│   ├── useHistoryStore.ts    [新增]
│   ├── useVocabularyStore.ts [新增]
│   └── useVoiceFlowStore.ts  [新增]
├── views/                     [新增目錄]
│   ├── DashboardView.vue     [新增 - 空白佔位]
│   ├── HistoryView.vue       [新增 - 空白佔位]
│   ├── DictionaryView.vue    [新增 - 空白佔位]
│   └── SettingsView.vue      [新增 - 空白佔位]
├── composables/
│   └── useTauriEvents.ts     [新增]
├── lib/
│   └── database.ts           [新增]
├── types/
│   ├── index.ts              [修改 - 新增 'enhancing' 狀態]
│   ├── transcription.ts      [新增]
│   ├── vocabulary.ts         [新增]
│   ├── settings.ts           [新增]
│   └── events.ts             [新增]
├── MainApp.vue               [新增]
├── main-window.ts            [新增]
└── router.ts                 [新增]

根目錄/
└── main-window.html          [新增]
```

**修改檔案清單：**
```
src/main.ts                   [修改 - 新增 Pinia 初始化]
src/types/index.ts            [修改 - HudStatus 新增 'enhancing']
src-tauri/Cargo.toml          [修改 - 新增 5 個依賴]
src-tauri/tauri.conf.json     [修改 - 新增 Main Window + plugins]
src-tauri/src/lib.rs          [修改 - 註冊新 plugins]
src-tauri/capabilities/default.json [修改 - 新增 plugin 權限]
vite.config.ts                [修改 - 多入口配置]
package.json                  [修改 - 自動由 pnpm add 更新]
```

### 已知衝突與現有程式碼

- **useVoiceFlow.ts** 目前直接管理 HUD 狀態，V2 計畫將此邏輯遷移至 useVoiceFlowStore。本 Story 只建立 store 骨架，不遷移現有邏輯（遷移在 Story 1.4 進行）。
- **main.ts** 目前是 `createApp(App).mount('#app')` 三行。本 Story 需新增 Pinia 初始化但不應破壞現有 HUD 行為。
- **App.vue** 不修改 — HUD Window 的行為保持不變。
- **transcriber.ts** 目前使用 `import.meta.env.VITE_GROQ_API_KEY` 讀取 API Key。本 Story 不修改此行為（API Key 儲存方式遷移在 Story 1.3 進行）。

### 技術版本確認（2026-03-01 最新）

| 技術 | 目標版本 | 最新穩定版 | 備註 |
|------|---------|-----------|------|
| rdev | 0.5.3 | 0.5.3 | 最新版，但維護者聲明長期未維護。macOS 需 Accessibility 權限 |
| tauri-plugin-sql | 2.3.1 | 2.3.1 | WAL mode 需手動 PRAGMA |
| tauri-plugin-store | ~2.x | 2.4.2 | 明文 JSON 儲存（已確認可接受，內部工具） |
| tauri-plugin-autostart | 2.5.1 | 2.5.1 | — |
| tauri-plugin-updater | ~2.2.0 | ~2.2.0 | — |
| vue-router | 5.0.3 | 5.0.3 | 從 v4 無 breaking changes |
| pinia | 3.x | 3.0.4 | 從 v2 幾乎零改動，需用 `defineStore('name', ...)` 語法 |

### 跨 Story 警告

- **tauri-plugin-store 明文儲存（已決策）** — 架構文件中「tauri-plugin-store 加密儲存 API Key」描述不準確，實際上 plugin-store 以明文 JSON 儲存。經 Jackle 確認：內部工具風險可接受，Story 1.3 繼續使用 tauri-plugin-store 明文儲存 API Key。
- **rdev 維護風險** — rdev maintainer 承認長期未維護，有 45 個未解決 issue。若 macOS/Windows 行為不一致，Story 1.2 可能需要 fallback 方案。

### References

- [Source: _bmad-output/planning-artifacts/architecture.md#Core Architectural Decisions — Data Architecture]
- [Source: _bmad-output/planning-artifacts/architecture.md#Implementation Patterns — Naming Patterns]
- [Source: _bmad-output/planning-artifacts/architecture.md#Project Structure & Boundaries]
- [Source: _bmad-output/planning-artifacts/epics.md#Epic 1 — Story 1.1]
- [Source: _bmad-output/planning-artifacts/prd.md#Desktop App Specific Requirements]
- [Source: Web Research — tauri-plugin-store docs.rs, tauri-plugin-sql WAL issue #2328, Pinia migration guide v2→v3]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (claude-opus-4-6)

### Debug Log References

- `cargo check` 通過，僅有既存 warnings（objc macro cfg, dead_code）
- `vue-tsc --noEmit` 僅有既存 `import.meta.env` 型別錯誤（transcriber.ts:17），無新增錯誤
- `vite build` 成功，雙入口（index.html + main-window.html）打包完成

### Completion Notes List

- ✅ Task 1: Cargo.toml 新增 5 個 Rust 依賴 + lib.rs 註冊 4 個 plugin + capabilities 擴展權限
- ✅ Task 2: pnpm 安裝 vue-router 5.0.3, pinia 3.0.4, 四個 @tauri-apps/plugin-* 套件
- ✅ Task 3: database.ts 實作 singleton pattern + WAL mode + 3 tables + 2 indexes
- ✅ Task 4: 四個 Pinia store 骨架建立，main.ts 加入 Pinia 初始化
- ✅ Task 5: main-window.html 建立，tauri.conf.json 雙視窗配置，vite.config.ts 多入口
- ✅ Task 6: main-window.ts 入口、MainApp.vue Sidebar、router.ts hash mode、四個 View 佔位
- ✅ Task 7: useTauriEvents.ts 封裝 emitToWindow/listenToEvent + 四個事件常數
- ✅ Task 8: HudStatus 新增 'enhancing'，四個新型別檔案（transcription/vocabulary/settings/events）
- ✅ Task 9: cargo check ✓、vite build ✓、vue-tsc 無新錯誤 ✓
- ⚠️ 既存問題：transcriber.ts 缺少 vite/client 型別宣告導致 import.meta.env 報錯（非本 Story 範圍）

### Change Log

- 2026-03-01: Story 1.1 完整實作 — V2 基礎架構（依賴、SQLite、Pinia、雙視窗、路由、事件系統、型別）

### File List

**新增檔案：**
- main-window.html
- src/main-window.ts
- src/MainApp.vue
- src/router.ts
- src/lib/database.ts
- src/stores/useSettingsStore.ts
- src/stores/useHistoryStore.ts
- src/stores/useVocabularyStore.ts
- src/stores/useVoiceFlowStore.ts
- src/views/DashboardView.vue
- src/views/HistoryView.vue
- src/views/DictionaryView.vue
- src/views/SettingsView.vue
- src/composables/useTauriEvents.ts
- src/types/transcription.ts
- src/types/vocabulary.ts
- src/types/settings.ts
- src/types/events.ts

**修改檔案：**
- src/main.ts — 新增 Pinia 初始化
- src/types/index.ts — HudStatus 新增 'enhancing'
- src-tauri/Cargo.toml — 新增 5 個 Rust 依賴
- src-tauri/src/lib.rs — 註冊 4 個新 plugin
- src-tauri/tauri.conf.json — 新增 Main Window 定義
- src-tauri/capabilities/default.json — 擴展 windows 和新增 plugin 權限
- vite.config.ts — 新增多入口 rollup 配置
- package.json — 新增 JS 依賴（由 pnpm add 自動更新）
- pnpm-lock.yaml — 鎖定檔更新
