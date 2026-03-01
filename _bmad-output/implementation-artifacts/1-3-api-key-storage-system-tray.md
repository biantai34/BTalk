# Story 1.3: API Key 安全儲存與 System Tray 整合

Status: in-progress

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a 使用者,
I want 安全地儲存我的 Groq API Key 並從 System Tray 開啟主視窗,
So that 我的 API Key 不會外洩，且能方便地存取 App 設定。

## Acceptance Criteria

1. **API Key 本地儲存** — 使用者在 SettingsView 的 API Key 輸入框中輸入 API Key 並儲存。API Key 透過 tauri-plugin-store 儲存於本地 `settings.json`（明文 JSON，安全依賴 OS 檔案系統權限，不存入 SQLite）。輸入框以密碼模式顯示（遮罩）。useSettingsStore 更新 `hasApiKey` 狀態。

2. **API Key 讀取與使用** — App 啟動或其他模組需要 API Key 時，可從 tauri-plugin-store 讀取已儲存的 API Key。API Key 僅在記憶體中供 `transcriber.ts`（及未來 `enhancer.ts`）使用。`transcriber.ts` 不再從 `import.meta.env.VITE_GROQ_API_KEY` 讀取。

3. **System Tray 選單開啟 Main Window** — 使用者透過 System Tray 右鍵選單的「開啟 Dashboard」項目開啟 Main Window 並顯示 Dashboard 頁面。若 Main Window 已開啟，則將其帶至前景。（兩平台統一透過選單開啟，不監聽 tray icon 點擊事件）

4. **首次啟動引導** — App 首次啟動且無 API Key 時，自動開啟 Main Window 並導向 Settings 頁面的 API Key 區塊，顯示提示訊息引導使用者輸入 API Key。

5. **System Tray 右鍵選單** — 使用者右鍵點擊 System Tray 圖示時，顯示選單項目：「開啟 Dashboard」、「結束」。選擇「開啟 Dashboard」開啟 Main Window。選擇「結束」關閉 App。

## Tasks / Subtasks

- [x] Task 1: 擴展 System Tray 選單與視窗管理 (AC: #3, #5)
  - [x] 1.1 在 `lib.rs` 新增 `"open-dashboard"` 選單項目（`MenuItem::with_id`），排在 `"quit"` 之前
  - [x] 1.2 `on_menu_event` 新增 `"open-dashboard"` 處理：呼叫 `show_main_window()` 輔助函式
  - [x] 1.3 建立 `show_main_window(app: &AppHandle)` 輔助函式：
    - `app.get_webview_window("main-window")` 取得視窗
    - 若視窗存在：`window.show()` + `window.set_focus()`
    - 若視窗不存在：不做動作（雙視窗在 tauri.conf.json 定義，App 生命週期內始終存在）
  - [x] 1.4 保留既有的 `"quit"` 選單項目行為不變（不加入 `on_tray_icon_event`，兩平台統一透過選單開啟視窗）

- [x] Task 2: 實作 API Key 儲存與讀取邏輯 (AC: #1, #2)
  - [x] 2.1 在 `useSettingsStore.ts` 新增 `apiKey` 私有 ref（不對外暴露原始值）：
    - `const apiKey = ref<string>("")` — 僅在 store 內部使用
    - 將現有 `const hasApiKey = ref(false)` 改為 `const hasApiKey = computed(() => apiKey.value !== "")` — 自動根據 apiKey 計算，不需手動更新
  - [x] 2.2 新增 `getApiKey(): string` getter — 回傳 `apiKey.value`，供 `transcriber.ts` 和未來 `enhancer.ts` 使用
  - [x] 2.3 新增 `saveApiKey(key: string)` action：
    - 驗證輸入：`key.trim()` 非空，否則拋出錯誤
    - 使用 `await load(STORE_NAME)` 載入 store（與現有 `loadSettings()` 一致）
    - `await store.set("groqApiKey", key.trim())` 寫入 API Key
    - `await store.save()` 確保持久化
    - 更新 `apiKey.value = key.trim()`（`hasApiKey` 為 computed 自動更新）
    - 包裹 try/catch 錯誤處理（遵循 `saveHotkeyConfig` 模式）
  - [x] 2.4 新增 `deleteApiKey()` action：
    - 使用 `await load(STORE_NAME)` 載入 store
    - `await store.delete("groqApiKey")`
    - `await store.save()`
    - 重置 `apiKey.value = ""`（`hasApiKey` 為 computed 自動更新為 false）
    - 包裹 try/catch 錯誤處理
  - [x] 2.5 擴展現有 `loadSettings()` — 新增讀取 `groqApiKey`：
    - `const savedKey = await store.get<string>("groqApiKey")`
    - 若存在：設定 `apiKey.value = savedKey`（`hasApiKey` 為 computed 自動更新）
    - 若不存在：保持預設值
  - [x] 2.6 匯出 `hasApiKey`（computed，自動 readonly）和 `getApiKey`、`saveApiKey`、`deleteApiKey` action
  - [x] 2.7 移除 `saveSettings()` 空函式和 TODO 註解（各別 save 函式已取代其用途）

- [x] Task 3: 改造 transcriber.ts 的 API Key 來源 (AC: #2)
  - [x] 3.1 移除 `transcriber.ts` 中的 `import.meta.env.VITE_GROQ_API_KEY` 讀取
  - [x] 3.2 修改 `transcribeAudio` 函式簽名，新增 `apiKey: string` 參數
  - [x] 3.3 函式內使用傳入的 `apiKey` 設定 `Authorization: Bearer ${apiKey}` header
  - [x] 3.4 若 `apiKey` 為空，拋出 `Error("API Key 未設定，請至設定頁面輸入 Groq API Key")`
  - [x] 3.5 更新 `useVoiceFlow.ts` 中的 `transcribeAudio` 呼叫：
    - 從 `useSettingsStore().getApiKey()` 取得 API Key
    - 傳入 `transcribeAudio(audioBlob, apiKey)`
    - 若 API Key 未設定，emit `voice-flow:state-changed` 帶 error 訊息引導設定

- [x] Task 4: 建立 SettingsView API Key 區塊 UI (AC: #1, #4)
  - [x] 4.1 在 `SettingsView.vue` 新增 API Key 設定區塊：
    - 區塊標題「Groq API Key」
    - 狀態 badge：已設定（綠）/ 未設定（紅）
  - [x] 4.2 API Key 輸入欄位：
    - `<input :type="isApiKeyVisible ? 'text' : 'password'">`
    - 眼睛圖示切換顯示/隱藏（`isApiKeyVisible` toggle）
    - placeholder：`"gsk_..."`
  - [x] 4.3 操作按鈕：
    - 「儲存」按鈕 → 呼叫 `settingsStore.saveApiKey(inputValue)`
    - 「刪除」按鈕（僅 hasApiKey 時顯示）→ 確認後呼叫 `settingsStore.deleteApiKey()`
  - [x] 4.4 儲存成功/失敗的短暫回饋提示（Tailwind transition）
  - [x] 4.5 API Key 取得說明連結或文字提示（引導使用者到 Groq Console 取得 Key）
  - [x] 4.6 使用既有 Tailwind 深色風格（`bg-zinc-900`, `text-white`, `text-zinc-400` 等，參考 `MainApp.vue`）

- [x] Task 5: 首次啟動 API Key 引導 (AC: #4)
  - [x] 5.1 在前端 `main-window.ts` 的 `bootstrap()` 中，`loadSettings()` 完成後檢查 `hasApiKey`：
    - 若 `hasApiKey === false`：先 `router.push('/settings')` 導向設定頁面
    - 等待 `nextTick()` 確保路由渲染完成
    - 再 `getCurrentWindow().show()` + `setFocus()` 顯示 Main Window（避免閃爍 Dashboard）
  - [x] 5.2 在 SettingsView 中，根據 `!hasApiKey` 狀態顯示引導提示（不使用 route query parameter）：
    - 「歡迎使用 SayIt！請先設定 Groq API Key 以啟用語音輸入功能。」
    - 提供 Groq Console 連結
    - 設定 API Key 後引導提示自動消失（hasApiKey 為 computed，自動更新）

- [ ] Task 6: 整合驗證 (AC: #1-5)
  - [x] 6.1 `cargo check` 通過
  - [x] 6.2 `vue-tsc --noEmit` 通過（消除 transcriber.ts 的 `import.meta.env` 型別錯誤）
  - [ ] 6.3 手動測試：API Key 儲存 → 重啟 App → API Key 仍可讀取
  - [ ] 6.4 手動測試：無 API Key 時 App 啟動引導至設定頁面
  - [ ] 6.5 手動測試：有 API Key 時錄音→轉錄→貼上流程正常
  - [ ] 6.6 手動測試：System Tray 右鍵選單「開啟 Dashboard」開啟 Main Window
  - [ ] 6.7 手動測試：System Tray 右鍵選單「結束」關閉 App
  - [ ] 6.8 手動測試：Main Window 已開啟時再選「開啟 Dashboard」，視窗帶至前景

## Dev Notes

### 架構模式與約束

**Brownfield 專案** — 基於 Story 1.1（V2 基礎架構）和 Story 1.2（跨平台熱鍵系統）繼續擴展。

**依賴方向規則（嚴格遵守）：**
```
views/ → components/ + stores/ + composables/
stores/ → lib/
lib/ → 外部 API（Groq）
composables/ → stores/ + lib/
```

**禁止：**
- ❌ views/ 直接呼叫 lib/（必須透過 store）
- ❌ API Key 存入 SQLite（只用 tauri-plugin-store）
- ❌ 在元件中直接執行 SQL

### tauri-plugin-store 使用要點

**依賴狀態：已安裝，不需新增依賴。**

| 項目 | 狀態 |
|------|------|
| `tauri-plugin-store` (Cargo.toml) | ✅ ~2.4 已安裝 |
| `@tauri-apps/plugin-store` (package.json) | ✅ ^2.4.2 已安裝 |
| `store:default` (capabilities/default.json) | ✅ 已有權限 |
| lib.rs plugin 註冊 | ✅ `tauri_plugin_store::Builder::default().build()` 已註冊 |

**前端 API 用法（與現有 useSettingsStore 一致）：**
```typescript
import { load } from "@tauri-apps/plugin-store";

// 載入 store（使用現有的 STORE_NAME 常數，與 loadSettings() 中已使用的方式一致）
const store = await load(STORE_NAME);  // STORE_NAME = "settings.json"

// 設值
await store.set("groqApiKey", apiKeyValue);

// 取值（支援泛型）
const key = await store.get<string>("groqApiKey");

// 刪除
await store.delete("groqApiKey");

// 持久化（autoSave 會自動觸發，但建議關鍵操作後手動 save）
await store.save();
```

**重要：tauri-plugin-store 為明文 JSON 儲存。** 儲存的 `settings.json` 是明文 JSON 檔案，安全依賴 OS 檔案系統權限（App Data 目錄僅限當前使用者存取）。API Key 不暴露於日誌、網路傳輸或 Tauri Events。這是已確認的架構決策（內部效率工具，明文本地儲存安全等級已足夠），不需要改用 stronghold。

**Store 檔案位置：** 各平台的 App Data 目錄（macOS: `~/Library/Application Support/com.sayit.app/settings.json`）

### transcriber.ts 改造重點

**現有 API Key 讀取方式（需替換）：**
```typescript
// ❌ 現有方式 — 從 .env 環境變數讀取
const apiKey = import.meta.env.VITE_GROQ_API_KEY;
if (!apiKey) {
  throw new Error("VITE_GROQ_API_KEY is not set in .env");
}
```

**改為參數注入：**
```typescript
// ✅ 新方式 — 透過參數傳入
export async function transcribeAudio(audioBlob: Blob, apiKey: string): Promise<TranscriptionResult> {
  if (!apiKey) {
    throw new Error("API Key 未設定，請至設定頁面輸入 Groq API Key");
  }
  // 使用 apiKey 設定 Authorization header
  // ...
}
```

**呼叫端（useVoiceFlow.ts）改動：**
```typescript
const settingsStore = useSettingsStore();
const apiKey = settingsStore.getApiKey();
if (!apiKey) {
  // emit error 引導使用者到設定頁面
  return;
}
const result = await transcribeAudio(audioBlob, apiKey);
```

**副作用：** 移除 `import.meta.env.VITE_GROQ_API_KEY` 將同時消除 `transcriber.ts:17` 的既存 `vue-tsc` 型別錯誤（前兩個 Story 已註記為非範圍內問題，本 Story 自然修復）。

### System Tray 改造重點

**現有 Tray 程式碼（lib.rs）：**
```rust
// 只有 quit 選單項
let quit_item = MenuItem::with_id(app, "quit", "Quit SayIt", true, None::<&str>)?;
let menu = Menu::with_items(app, &[&quit_item])?;

TrayIconBuilder::new()
    .menu(&menu)
    .tooltip("SayIt")
    .on_menu_event(|app, event| match event.id.as_ref() {
        "quit" => { app.exit(0); }
        _ => {}
    })
    .build(app)?;
```

**需要改為：**
```rust
// 新增「開啟 Dashboard」選單項
let open_item = MenuItem::with_id(app, "open-dashboard", "開啟 Dashboard", true, None::<&str>)?;
let quit_item = MenuItem::with_id(app, "quit", "Quit SayIt", true, None::<&str>)?;
let menu = Menu::with_items(app, &[&open_item, &quit_item])?;

TrayIconBuilder::new()
    .menu(&menu)
    .tooltip("SayIt")
    .on_menu_event(|app, event| match event.id.as_ref() {
        "open-dashboard" => { show_main_window(app); }
        "quit" => { app.exit(0); }
        _ => {}
    })
    // 不加入 on_tray_icon_event — 兩平台統一透過選單開啟視窗
    .build(app)?;
```

**show_main_window 輔助函式：**
```rust
fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main-window") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}
```

**注意事項：**
- 視窗 label 是 `"main-window"`（tauri.conf.json 中定義）
- `visible: false` 是預設值 — 視窗物件始終存在但隱藏
- `show()` + `set_focus()` 組合確保視窗可見且在前景

### 首次啟動引導邏輯

**推薦方案：前端驅動（main-window.ts）**

```typescript
// main-window.ts bootstrap() 中
async function bootstrap() {
  await initializeDatabase();
  const pinia = createPinia();
  const app = createApp(MainApp).use(pinia).use(router);
  app.mount("#app");

  // 首次啟動引導
  const settingsStore = useSettingsStore();
  await settingsStore.loadSettings();
  if (!settingsStore.hasApiKey) {
    // 先導向設定頁面，再顯示視窗，避免閃爍 Dashboard
    router.push("/settings");
    const { nextTick } = await import("vue");
    await nextTick();
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().show();
    await getCurrentWindow().setFocus();
  }
}
```

**為何前端驅動優於 Rust 驅動：**
- `hasApiKey` 的判斷需要讀取 tauri-plugin-store，前端已有 Store API
- 路由跳轉需要在 Vue Router 層面完成
- Rust 側不需要知道 API Key 狀態（前端直接呼叫 Groq API）

### 現有 useSettingsStore 程式碼分析

**已實作（Story 1.2）：**
- `hotkeyConfig` ref + `triggerMode` computed
- `loadSettings()` — 讀取 hotkeyTriggerKey、hotkeyTriggerMode，同步 Rust
- `saveHotkeyConfig()` — 寫入 store + invoke update_hotkey_config
- Store 名稱：`"settings.json"`

**待實作（本 Story）：**
- `apiKey` ref（私有，不對外暴露）
- `hasApiKey` 改為 `computed(() => apiKey.value !== "")`
- `getApiKey(): string` getter（回傳 apiKey.value）
- `saveApiKey(key: string)` / `deleteApiKey()` actions
- `loadSettings()` 擴展讀取 groqApiKey
- 移除 `saveSettings()` 空函式和 TODO 註解（各別 save 函式已取代）

**Store 實例共用：** `loadSettings()` 已有 `const store = await load(STORE_NAME)`，新增的 API Key 操作使用相同 `STORE_NAME` 常數。`load()` 內部有快取機制，多次呼叫回傳同一實例。

### SettingsView UI 設計指引

**風格參考（MainApp.vue 深色主題）：**
- 背景：`bg-zinc-900`
- 文字：`text-white`（標題）、`text-zinc-400`（副標題）
- 邊框：`border-zinc-700`
- 輸入框：`bg-zinc-800 text-white border border-zinc-600 rounded-lg px-4 py-2`
- 按鈕（主要）：`bg-blue-600 hover:bg-blue-500 text-white rounded-lg px-4 py-2`
- 按鈕（危險）：`bg-red-600/20 text-red-400 hover:bg-red-600/30 rounded-lg px-4 py-2`
- Badge（成功）：`bg-green-500/20 text-green-400 text-xs px-2 py-0.5 rounded-full`
- Badge（警告）：`bg-red-500/20 text-red-400 text-xs px-2 py-0.5 rounded-full`

**UI 結構建議：**
```
┌─ API Key 設定 ──────────────────────────────────┐
│                                                   │
│  Groq API Key  [已設定 ●] 或 [未設定 ●]           │
│                                                   │
│  ┌──────────────────────────────┐  👁  ┌───────┐ │
│  │ gsk_••••••••••••••••••••     │      │ 儲存  │ │
│  └──────────────────────────────┘      └───────┘ │
│                                                   │
│  💡 前往 console.groq.com 取得 API Key             │
│                                                   │
│  [刪除 API Key]  ← 僅已設定時顯示                  │
└───────────────────────────────────────────────────┘
```

### 跨 Story 注意事項

- **Story 1.4** 會將 `useVoiceFlow.ts` 遷移至 `useVoiceFlowStore`。本 Story 的 `transcribeAudio` 呼叫改動在 `useVoiceFlow.ts` composable 中進行，1.4 遷移時需同步搬移。
- **Story 2.1** 會建立 `enhancer.ts`，也需要 API Key。本 Story 的 `getApiKey()` 設計已考慮到這一點，`enhancer.ts` 可直接從 `useSettingsStore` 取用。
- **Story 5.1** 會建立完整的快捷鍵設定 UI。本 Story 的 SettingsView 只處理 API Key 區塊，預留空間給 5.1 的快捷鍵區塊。

### 前一個 Story (1.2) 關鍵學習

- `cargo check` 有既存 warnings（objc macro cfg, dead_code）— 不影響功能，不需處理
- `vue-tsc --noEmit` 有 `transcriber.ts:17` 的 `import.meta.env` 型別錯誤 — **本 Story 移除 env 讀取後將自然修復**
- tauri-plugin-updater 已從 lib.rs 移除（commit ae44200）— 不要重新加入
- useSettingsStore 的 `loadSettings()` 已有完整的 store 讀取框架，本 Story 在同一模式下擴展
- 前端 TriggerKey 使用 union type 保持與 Rust serde 一致 — 沿用此模式
- `HotkeyListenerState` 的 `is_pressed`/`is_toggled_on` 改為 `Arc<AtomicBool>` — 跨線程共享的正確做法

### Git 歷史分析

最近 commit 模式：
- `feat:` 前綴用於功能實作（Story 1.1, 1.2）
- `fix:` 前綴用於 code review 後修復
- `docs:` 前綴用於 BMAD artifacts 更新
- `refactor:` 前綴用於重新命名/重構

**最近改動的關鍵檔案（與本 Story 相關）：**
- `src-tauri/src/lib.rs` — Story 1.2 新增了 `update_hotkey_config` command 和 `hotkey_listener` plugin 註冊
- `src/stores/useSettingsStore.ts` — Story 1.2 建立了 loadSettings/saveHotkeyConfig 框架
- `src/composables/useVoiceFlow.ts` — Story 1.2 替換了事件監聽為新 hotkey 事件
- `src/lib/transcriber.ts` — POC 以來未變動，仍使用 env var

### 技術版本確認（2026-03-02）

| 技術 | 版本 | 備註 |
|------|------|------|
| tauri-plugin-store (Rust) | ~2.4 | 已安裝，已在 lib.rs 註冊 |
| @tauri-apps/plugin-store (JS) | ^2.4.2 | 已安裝，已在 useSettingsStore 使用 |
| Tauri tray-icon feature | 2.x | 已啟用，lib.rs 已有 tray 設定 |

### 不需要的 Cargo/NPM 依賴變更

本 Story **不需要安裝任何新依賴**。所有需要的 plugin 已在 Story 1.1 安裝完畢。

### 現有檔案改動點

**修改檔案：**
```
src-tauri/src/lib.rs                  — 擴展 Tray 選單 + show_main_window + 首次啟動引導（可選）
src/stores/useSettingsStore.ts        — 新增 API Key 儲存/讀取/刪除邏輯
src/lib/transcriber.ts                — 移除 env var，改為 apiKey 參數注入
src/composables/useVoiceFlow.ts       — 呼叫 transcribeAudio 時傳入 API Key
src/views/SettingsView.vue            — 建立 API Key 設定 UI
src/main-window.ts                    — 新增首次啟動引導（loadSettings → 檢查 hasApiKey → 導向 settings）
```

**不修改的檔案（明確排除）：**
- `App.vue` — HUD 行為不變
- `MainApp.vue` — sidebar 結構不變
- `router.ts` — 路由已定義，不需改動
- `hotkey_listener.rs` — 熱鍵邏輯不變
- `clipboard_paste.rs` — 剪貼簿邏輯不變
- `database.ts` — SQLite 不存 API Key
- `Cargo.toml` — 不需新增依賴
- `package.json` — 不需新增依賴
- `capabilities/default.json` — `store:default` 已有

### 安全規則提醒

- API Key 不寫入任何日誌（`console.log` 不印 Key 值）
- API Key 不透過 Tauri Event 傳播（不 emit API Key）
- CSP `connect-src 'self' https://api.groq.com` 限制 API Key 只能傳到 Groq
- `settings.json` 儲存在 App Data 目錄，不進 git

### Project Structure Notes

- 本 Story 改動符合統一專案結構：store 層處理資料持久化，view 層處理 UI，lib 層處理 API 呼叫
- `transcriber.ts` 保持為純邏輯 service（lib/ 層），不引入 Vue/Pinia 依賴 — API Key 透過參數注入而非在 service 內 import store
- SettingsView.vue 只透過 `useSettingsStore` 操作設定，不直接使用 `Store` API

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic 1 — Story 1.3]
- [Source: _bmad-output/planning-artifacts/architecture.md#Security — tauri-plugin-store 本地儲存]
- [Source: _bmad-output/planning-artifacts/architecture.md#Frontend Architecture — Pinia Stores 結構]
- [Source: _bmad-output/planning-artifacts/architecture.md#Project Structure & Boundaries — Data Boundaries]
- [Source: _bmad-output/planning-artifacts/prd.md#應用程式管理 FR31-FR32]
- [Source: _bmad-output/implementation-artifacts/1-2-rdev-cross-platform-hotkey.md — 跨 Story 注意事項]
- [Source: Codebase — src-tauri/src/lib.rs（System Tray 現有實作）]
- [Source: Codebase — src/stores/useSettingsStore.ts（Story 1.2 已建立框架）]
- [Source: Codebase — src/lib/transcriber.ts（env var API Key 讀取）]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex (CLI)

### Debug Log References

- 2026-03-02 `cargo check --manifest-path src-tauri/Cargo.toml` ✅
- 2026-03-02 `pnpm exec vue-tsc --noEmit` ✅
- 2026-03-02 `pnpm test` ✅（6 files / 77 tests 全部通過）
- 手動整合驗證（6.3~6.8）需在 GUI 環境執行，CLI 無法直接完成

### Completion Notes List

- 完成 Task 1~5 與 Task 6.1~6.2：System Tray 新增「開啟 Dashboard」、API Key 本地儲存/刪除/讀取、轉錄流程改為參數注入 API Key、SettingsView API Key UI、首次啟動導向設定頁面。
- `transcriber.ts` 不再讀取 `import.meta.env.VITE_GROQ_API_KEY`，改由 `useSettingsStore().getApiKey()` 提供，且缺少 API Key 時 emit `voice-flow:state-changed` 錯誤訊息。
- 更新並修正對應單元測試（`transcriber`、`use-voice-flow`），目前測試綠燈。
- 保留 Task 6.3~6.8 未勾選，待使用者在本機桌面環境完成手動驗證後再標記完成並切換至 `review`。

### File List

- src-tauri/src/lib.rs
- src/stores/useSettingsStore.ts
- src/lib/transcriber.ts
- src/lib/errorUtils.ts
- src/composables/useVoiceFlow.ts
- src/views/SettingsView.vue
- src/main-window.ts
- tests/unit/transcriber.test.ts
- tests/unit/use-voice-flow.test.ts
- _bmad-output/implementation-artifacts/sprint-status.yaml
- _bmad-output/implementation-artifacts/1-3-api-key-storage-system-tray.md

## Change Log

- 2026-03-02: 完成 Story 1.3 主要開發與自動化驗證，Story 狀態更新為 `in-progress`（待手動整合驗證 6.3~6.8）。
- 2026-03-02: Code Review 修復 — (1) 新增 `getApiKey()` getter，`apiKey` ref 不再對外暴露 (2) SettingsView 移除對 `lib/errorUtils` 的直接 import（架構邊界修復）(3) 移除未使用的 `aiPrompt` ref (4) File List 補上 `errorUtils.ts` (5) 更新 `useVoiceFlow.ts` 和測試改用 `getApiKey()` — 6 files / 77 tests ✅，vue-tsc ✅。
