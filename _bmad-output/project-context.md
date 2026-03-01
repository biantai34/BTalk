---
project_name: 'sayit'
user_name: 'Jackle'
date: '2026-03-01'
sections_completed: ['technology_stack', 'language_rules', 'framework_rules', 'testing_rules', 'code_quality', 'workflow_rules', 'critical_rules']
status: 'complete'
rule_count: 62
optimized_for_llm: true
---

# Project Context for AI Agents

_This file contains critical rules and patterns that AI agents must follow when implementing code in this project. Focus on unobvious details that agents might otherwise miss._

---

## Technology Stack & Versions

### Core Technologies

| Layer | Technology | Version | Notes |
|-------|-----------|---------|-------|
| Desktop Framework | Tauri | v2.10.x | 雙視窗、System Tray、macOS Private API |
| Frontend | Vue 3 | 3.5.29 | Composition API only（不使用 Options API） |
| Language (Frontend) | TypeScript | 5.9.3 | strict mode 啟用 |
| Language (Backend) | Rust | 2021 edition | — |
| CSS | Tailwind CSS | 4.2.1 | v4 使用 `@import "tailwindcss"` 語法 |
| Build | Vite | 6.4.1 | — |
| Package Manager | pnpm | — | 必須使用 pnpm，不可用 npm/yarn |

### Rust Dependencies (src-tauri)

| Crate | Version | Purpose |
|-------|---------|---------|
| tauri | 2.x | features: tray-icon, macos-private-api |
| tauri-plugin-shell | 2.x | Shell 操作 |
| tauri-plugin-http | 2.x | HTTP 請求 |
| arboard | 3.x | 跨平台剪貼簿操作 |
| ~~enigo~~ | ~~0.2~~ | ~~跨平台鍵盤模擬~~ — 已移除（零使用死依賴） |
| serde / serde_json | 1.x | 序列化 |
| thiserror | 2.x | 錯誤型別定義 |
| objc + core-graphics + core-foundation | macOS only | macOS 視窗控制 |
| windows | 0.61 | Windows only 視窗控制 |

### V2 Planned Dependencies (尚未安裝)

- Rust: tauri-plugin-sql (sqlite), tauri-plugin-autostart, tauri-plugin-updater, tauri-plugin-store（明文 JSON 本地儲存；rdev 已取消，改用 OS-native API）
- JS: vue-router 5.x, pinia 3.x, 對應 tauri plugin 前端 bindings

### External APIs

- Groq Whisper API — 語音轉文字（POST multipart/form-data）
- Groq LLM API — AI 文字整理（POST JSON，5 秒 timeout）
- CSP 白名單：`connect-src 'self' https://api.groq.com`

## Critical Implementation Rules

### Language-Specific Rules

#### TypeScript

- **strict mode 啟用** — `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch` 全部開啟，不可有未使用變數
- **target ES2021** — 可使用 `Promise.allSettled()`, `??`, `?.` 等語法，但不可使用 ES2022+ 特性
- **`import type` 分離** — 純型別匯入必須使用 `import type { Xxx }` 語法，避免 runtime 多餘引入
- **模組系統** — ESNext modules（`"type": "module"`），匯入路徑不帶 `.ts` 副檔名
- **環境變數前綴** — 前端環境變數必須以 `VITE_` 或 `TAURI_` 開頭才能在 WebView 中存取
- **錯誤訊息格式** — `err instanceof Error ? err.message : String(err)` 作為標準錯誤取值模式

#### Rust

- **Tauri Command 簽名** — 必須加泛型 `<R: Runtime>` 約束，返回 `Result<T, CustomError>`
- **錯誤型別** — 使用 `thiserror` crate 定義 enum，且必須手動 `impl serde::Serialize` 才能跨 Tauri 回傳前端
- **平台隔離** — 平台特定程式碼用 `#[cfg(target_os = "macos")]` / `#[cfg(target_os = "windows")]` 隔離，不可在同一函式中混合
- **unsafe 標記** — macOS `objc::msg_send!` 呼叫必須在 `unsafe {}` 區塊內
- **原子操作** — 跨執行緒共享狀態使用 `AtomicBool` + `Ordering::SeqCst`
- **Plugin 模式** — 每個功能模組是獨立的 `TauriPlugin<R>`，在 `plugins/mod.rs` 中 `pub mod` 匯出

### Framework-Specific Rules

#### Vue 3 (Composition API)

- **僅使用 `<script setup>` 或 `setup()` 函式** — 禁止 Options API（data/methods/computed 物件語法）
- **Composable 模式** — 可複用邏輯封裝為 `useXxx()` 函式，放在 `src/composables/`
- **狀態暴露** — Composable 內部用 `ref()` 管理狀態，對外返回 `readonly()` 防止直接修改
- **計算屬性** — 衍生狀態一律用 `computed()` 而非手動 watch + 賦值
- **元件命名** — SFC 檔案名 PascalCase，模板中使用 `<PascalCase />` 自閉合標籤
- **條件 class** — 使用 `:class="{ 'class-name': condition }"` 綁定語法

#### Tauri v2 通訊

- **前端 → Rust** — 使用 `invoke('command_name', { args })` 呼叫 Tauri Command
- **Rust → 前端** — 使用 `emit()` / `emitTo(windowLabel, event, payload)` 發送事件
- **前端監聽** — 使用 `listen('event-name', callback)` 訂閱事件，記得在元件卸載時 `unlisten()`
- **Event 命名** — `{domain}:{action}` kebab-case 格式（如 `voice-flow:state-changed`）
- **HTTP 請求** — 使用 `@tauri-apps/plugin-http` 的 `fetch`（非瀏覽器原生 fetch），繞過 CORS
- **視窗操作** — 使用 `getCurrentWindow()` 取得當前視窗實例

#### Tailwind CSS v4

- **入口語法** — `@import "tailwindcss"`（非 v3 的 @tailwind 指令）
- **Vite 整合** — 透過 `@tailwindcss/vite` plugin，非 PostCSS 配置
- **混合使用** — Tailwind 工具類 + `<style scoped>` 自訂樣式共存，複雜動畫放 scoped style

### Testing Rules

- **MVP 階段** — 目前無測試框架，Phase 1 以手動測試為主
- **不主動新增測試** — 除非使用者明確要求，AI agents 不應自行建立測試檔案或安裝測試框架
- **Phase 2 預留** — 未來測試框架選型尚未決定，目錄結構預留空間
- **型別檢查作為品質門檻** — `vue-tsc --noEmit` 是目前唯一的自動化品質檢查（build script 中）
- **手動驗證重點** — E2E 流程：熱鍵觸發 → 錄音 → 轉錄 → (AI 整理) → 貼上，以及 HUD 狀態轉換

### Code Quality & Style Rules

#### 命名慣例

| 類型 | 慣例 | 範例 |
|------|------|------|
| Vue 元件檔案 | PascalCase | `NotchHud.vue`, `DashboardView.vue` |
| Composable 檔案 | camelCase + use 前綴 | `useHudState.ts`, `useVoiceFlow.ts` |
| Service/Lib 檔案 | camelCase | `recorder.ts`, `transcriber.ts` |
| Pinia Store 檔案 | camelCase + use 前綴 | `useSettingsStore.ts` |
| Rust 模組檔案 | snake_case | `clipboard_paste.rs`, `hotkey_listener.rs` |
| 資料夾 | kebab-case | `src-tauri/`, `components/` |
| TS 變數/函式 | camelCase | `startRecording()`, `enhancedText` |
| TS 型別/介面 | PascalCase + 後綴 | `TranscriptionRecord`, `SettingsDto` |
| TS 布林變數 | is/has/can/should 前綴 | `isRecording`, `wasEnhanced`, `hasApiKey` |
| TS 常數 | UPPER_SNAKE_CASE | `DEFAULT_PROMPT`, `API_TIMEOUT_MS` |
| Rust 函式/變數 | snake_case | `paste_text()`, `listen_hotkey()` |
| Rust 型別/Struct | PascalCase | `ClipboardError`, `HotkeyConfig` |
| SQLite table | 複數 snake_case | `transcriptions`, `vocabulary` |
| SQLite column | snake_case | `raw_text`, `was_enhanced` |
| Tauri Events | {domain}:{action} kebab-case | `voice-flow:state-changed` |
| Pinia Store ID | kebab-case | `defineStore('settings', ...)` |

#### 檔案組織規則

- **元件** → `src/components/`，**頁面** → `src/views/`
- **純邏輯（無 Vue 依賴）** → `src/lib/`，**Vue 相關邏輯** → `src/composables/` 或 `src/stores/`
- **型別定義** → `src/types/`
- **Rust plugin** → `src-tauri/src/plugins/`，一個檔案一個模組
- **依賴方向單向** — `views → components + stores + composables`，`stores → lib`，`lib → 外部 API`
- **禁止** `views/` 直接呼叫 `lib/`，必須透過 store

#### 日誌格式

- **TypeScript** — `console.log("[ModuleName] message")` 或 `log("moduleName: message")`
- **Rust** — `println!("[module-name] message")` / `eprintln!("[module-name] ERROR: message")`
- **模組前綴** — 所有日誌必須帶模組名前綴，方便追蹤來源

#### 無 Linter/Formatter 配置

- 目前無 ESLint / Prettier — 依賴 TypeScript strict mode + 手動一致性
- AI agents 應遵循現有程式碼風格，不主動新增 linting 工具

### Development Workflow Rules

#### 開發指令

- **開發模式** — `pnpm tauri dev`（同時啟動 Vite dev server + Rust 編譯）
- **前端 dev server** — `localhost:1420`，HMR 在 port 1421
- **建構** — `pnpm tauri build`（Vite 打包 → Cargo 編譯 → Tauri bundler）
- **型別檢查** — `vue-tsc --noEmit`（build 前自動執行）
- **Vite watch 排除** — `**/src-tauri/**` 被 ignore，Rust 變更不觸發 HMR

#### Git 慣例

- **Commit message** — Conventional Commits 格式（`feat:`, `fix:`, `refactor:` 等）
- **不主動 commit** — AI agents 完成修改後報告 git 狀態，等使用者指示
- **單一主題** — 每個 commit 聚焦一個主題，大量變更（20+ 檔案）分批 commit

#### 產出格式

- **macOS** — `.dmg`（含 `.app`），簽署用 `TAURI_SIGNING_PRIVATE_KEY` 環境變數
- **Windows** — `.msi` 或 NSIS `.exe`
- **自動更新** — tauri-plugin-updater + 自訂 endpoint（`update-server/latest.json`）

#### 環境變數

- **`VITE_GROQ_API_KEY`** — 開發時 Groq API Key（前端可存取）
- **`TAURI_SIGNING_PRIVATE_KEY`** — 建構簽署金鑰（僅 CI/CD）
- **`.env` 不進 git** — `.gitignore` 排除，提供 `.env.example` 範例

### Critical Don't-Miss Rules

#### Anti-Patterns（絕對禁止）

- **❌ 瀏覽器原生 `fetch`** — 必須用 `@tauri-apps/plugin-http` 的 `fetch`，否則會被 CSP 擋住或遇 CORS
- **❌ Options API** — 禁止 `data()`, `methods:`, `computed:` 物件語法，一律 Composition API
- **❌ views 直接呼叫 lib** — 頁面元件不可直接 import `lib/` 下的模組，必須透過 Pinia store
- **❌ SQLite 存 API Key** — API Key 只存在 `tauri-plugin-store`（明文 JSON，安全依賴 OS 檔案權限），絕不進 SQLite
- **❌ 跨平台程式碼混合** — macOS 和 Windows 特定邏輯不可在同一函式中，必須用 `#[cfg]` 隔離
- **❌ 在元件中直接執行 SQL** — SQLite 操作只從 Pinia store actions 發起

#### 資料映射陷阱

- **SQLite → TypeScript 欄位映射** — SQLite `snake_case` → TS `camelCase`，在 store action 中手動轉換
- **Tauri Event payload** — 一律 camelCase JSON，不是 Rust 的 snake_case
- **Rust Command 回傳** — `serde` 預設序列化 Rust struct 為 snake_case JSON，前端需對應處理

#### 錯誤處理鏈路

- **Service 層（lib/）** — 拋出有意義的 `Error`，帶上下文訊息
- **Store 層** — `try/catch` 攔截 → 狀態更新 → 降級策略
- **Whisper API 失敗** → HUD 顯示錯誤，使用者可重試
- **LLM API 超時（5 秒）** → 跳過 AI 整理，直接貼上原始文字
- **Rust Command 失敗** → `Result<T, E>` 自動轉前端 Promise rejection

#### 安全規則

- **CSP 硬限制** — `connect-src 'self' https://api.groq.com`，新增外部 API 必須更新 `tauri.conf.json`
- **API Key 不出本地** — 只在本機 tauri-plugin-store 中（明文 JSON，OS 檔案權限保護），不上傳、不寫入日誌、不透過 Tauri Events 傳播
- **macOS 權限** — Accessibility 權限是全域熱鍵監聽的前提，`hotkey_listener.rs`（CGEventTap）會檢查

#### 效能注意事項

- **HUD 動畫不阻塞主流程** — 狀態轉換透過 Tauri Events 驅動，非輪詢
- **E2E 目標** — 含 AI < 3 秒、不含 AI < 1.5 秒
- **字數門檻** — 轉錄文字 < 10 字元跳過 AI 整理，直接貼上
- **idle 記憶體** — 目標 < 100MB

---

## Usage Guidelines

**For AI Agents:**

- Read this file before implementing any code
- Follow ALL rules exactly as documented
- When in doubt, prefer the more restrictive option
- Reference `_bmad-output/planning-artifacts/architecture.md` for detailed architectural decisions

**For Humans:**

- Keep this file lean and focused on agent needs
- Update when technology stack changes
- Review periodically for outdated rules
- Remove rules that become obvious over time

Last Updated: 2026-03-01
