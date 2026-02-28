# NoWayLM Voice — 產品規格書

**文件建立日期：** 2026-02-23
**文件更新日期：** 2026-02-28 21:00:00
**狀態：** Draft — V2 功能擴展規劃中

---

## 決策紀錄（2026-02-24）

### UI 方向收斂

- 採用 **Boring Notch 風格** 的視覺語言與動畫節奏
- POC v1 僅做 **非互動式狀態 HUD**（錄音中 / 轉錄中 / 完成 / 錯誤）
- 不追求 macOS 系統層「原生 Dynamic Island」整合；目標是 **高相似度體驗**

### 實作策略

- 以 **Tauri 自製 UI** 為主，參考現有 Open Source（如 Boring Notch / DynamicNotchKit 類）設計思路
- 不將特定 macOS 原生套件（如 SwiftUI library）納入 POC 必要依賴
- 將 HUD 呈現層與錄音/轉錄流程分離，保留未來替換為原生實作的空間

### 跨平台策略（產品方向）

- macOS：Notch-style HUD（貼近瀏海區域）
- Windows：上方置中膠囊 HUD（沿用相同視覺語言與狀態機）
- Windows 熱鍵不綁定 `Fn`，改為可設定快捷鍵（例如 `F5` 或其他組合鍵）

### Phase 2 定義調整

- 若 v1 僅需非互動式 HUD，則 **不需要額外 Phase 2**
- 僅當需求升級為「可互動式 notch panel」（點擊展開、控制項、歷史紀錄等）時，才開啟 Phase 2（含 macOS 原生橋接評估）

---

## 目標

用最小範圍驗證「按住 Fn 鍵錄音 → 語音轉文字 → 自動貼進任何 App」的完整技術流程。

**POC 成功標準：**
1. 按住 Fn → 出現 Boring Notch 風格 HUD 提示 → 開始錄音
2. 放開 Fn → 停止錄音 → 送 Groq Whisper API → 取得文字
3. 文字自動貼進當前焦點的任何 App（Slack、Notion、Word 等）
4. 整體延遲 < 3 秒（放開到文字出現）

---

## 技術架構

```
+--------------------------------------------------+
|  Tauri Desktop App（System Tray 常駐）             |
|                                                    |
|  Rust Plugin Layer:                                |
|  ┌──────────────────────────────────────────────┐  |
|  │  fn_key_listener (CGEventTap)                │  |
|  │  - 監聽 Fn key down / up                     │  |
|  │  - 需要 Accessibility 權限                   │  |
|  └──────────────────┬───────────────────────────┘  |
|                     │ Event                        |
|                     v                              |
|  ┌──────────────────────────────────────────────┐  |
|  │  WebView (Svelte / Vue)                      │  |
|  │  - Notch-style 狀態 HUD UI                  │  |
|  │  - MediaRecorder 錄音                        │  |
|  │  - 呼叫 Groq Whisper API                     │  |
|  └──────────────────┬───────────────────────────┘  |
|                     │ 轉錄結果                     |
|                     v                              |
|  ┌──────────────────────────────────────────────┐  |
|  │  clipboard_paste (Rust)                      │  |
|  │  - 備份剪貼簿                                │  |
|  │  - 寫入轉錄文字                              │  |
|  │  - 模擬 Cmd+V                                │  |
|  │  - 還原剪貼簿                                │  |
|  └──────────────────────────────────────────────┘  |
+--------------------------------------------------+
```

---

## 技術棧

| 項目 | 選型 | 說明 |
|------|------|------|
| 桌面框架 | **Tauri v2** | 輕量跨平台 |
| 前端 | **Svelte** (同 Whispering) 或 **Vue** (同 NoWayLM) | POC 階段擇一 |
| 語言 | **Rust** (後端) + **TypeScript** (前端) | |
| 語音辨識 | **Groq Whisper API** | 低延遲雲端轉錄 |
| 套件管理 | **Bun** 或 **pnpm** | |

---

## 功能模組明細

### 模組 1：Fn 鍵監聽（Rust Plugin）

**目標：** 在 macOS 上捕捉 Fn 鍵的按下/放開事件

**技術做法：**
- 使用 `CGEventTapCreate` 建立系統級事件攔截器
- 監聽 `flagsChanged` 事件中的 `kCGEventFlagMaskSecondaryFn` flag
- Fn down → emit `recording-start` 事件到前端
- Fn up → emit `recording-stop` 事件到前端

**需要的權限：**
- macOS「輔助使用（Accessibility）」權限
- App 啟動時需引導使用者授權

**跨平台策略（POC 範圍外）：**
- Windows 可改用 F5 或可自訂按鍵

---

### 模組 2：麥克風錄音（前端 WebView）

**目標：** 在 Fn 按下時開始錄音，放開時停止

**技術做法：**
- 使用 `navigator.mediaDevices.getUserMedia()` 取得麥克風
- 使用 `MediaRecorder` API 錄製音訊
- 輸出格式：`audio/webm` 或 `audio/wav`
- 錄音時顯示 Notch-style 狀態 HUD

**錄音流程：**
```
Fn down 事件
    → getUserMedia (首次需使用者允許麥克風)
    → new MediaRecorder(stream)
    → recorder.start()
    → UI 顯示「錄音中...」

Fn up 事件
    → recorder.stop()
    → 收集 audio blob
    → UI 顯示「轉錄中...」
    → 送出 API 請求
```

---

### 模組 3：Groq Whisper API 串接

**目標：** 將錄音音訊送到 Groq API 取得轉錄文字

**API Endpoint：**
```
POST https://api.groq.com/openai/v1/audio/transcriptions
Headers:
  Authorization: Bearer <GROQ_API_KEY>
Content-Type: multipart/form-data
Body:
  file: <audio_blob>
  model: "whisper-large-v3"
  language: "zh"          # 繁體中文
  response_format: "text"
```

**POC 階段 API Key 管理：**
- 直接寫在環境變數 `.env` 中
- 未來正式版改走 NoWayLM 後端中繼

---

### 模組 4：剪貼簿注入（Rust Plugin）

**目標：** 將轉錄文字貼進當前焦點的任何 App

**技術做法：**
```
1. 讀取並備份目前剪貼簿內容 (NSPasteboard / arboard crate)
2. 將轉錄文字寫入剪貼簿
3. 模擬按下 Cmd+V (CGEventCreateKeyboardEvent)
4. 等待 100ms
5. 還原原本的剪貼簿內容
```

**使用的 Rust Crates：**
- `arboard` — 跨平台剪貼簿操作
- `enigo` 或 `core-graphics` — 模擬鍵盤按鍵

---

### 模組 5：Notch-style 狀態 HUD（Boring Notch 風格）

**目標：** 提供視覺回饋讓使用者知道目前狀態

**UI 狀態機：**
```
[待機] ──Fn down──► [錄音中 🔴] ──Fn up──► [轉錄中 ⏳] ──完成──► [成功 ✓] ──► [待機]
                                                          |
                                                       [錯誤 ⚠]
```

**視覺設計（POC v1）：**
- 膠囊型 HUD（Boring Notch 風格，非互動）
- 預設尺寸約 `240~320x56~72px`（依狀態可微幅伸縮）
- 顯示位置：
  - 有瀏海 Mac：螢幕上方置中，貼近瀏海下緣
  - 無瀏海 Mac / 外接螢幕 / Windows：螢幕上方置中
- 錄音中：紅點脈衝 / 波形動畫 + 「錄音中...」
- 轉錄中：loading spinner + 「轉錄中...」
- 成功：短暫顯示「已貼上」後自動收起（約 `0.8~1.2s`）
- 錯誤：顯示錯誤提示後自動收起或回待機

**v1 範圍限制：**
- 不支援滑鼠互動（點擊、拖曳、展開）
- 不支援歷史紀錄或操作面板
- 以狀態提示為主，不承載複雜 UI 控制項

---

## 專案結構（在 NoWayLM monorepo 中）

```
NoWayLM/
  packages/
    voice-desktop/              # ← POC 專案
      src/                      # 前端 (Svelte/Vue)
        App.svelte              # 主 UI
        lib/
          recorder.ts           # 錄音邏輯
          transcriber.ts        # Groq API 串接
      src-tauri/                # Rust 後端
        src/
          main.rs               # Tauri 入口
          plugins/
            fn_key_listener.rs  # Fn 鍵監聽 plugin
            clipboard_paste.rs  # 剪貼簿注入 plugin
        Cargo.toml
        tauri.conf.json
      .env                      # GROQ_API_KEY（不進版控）
      package.json
      vite.config.ts
```

---

## 不包含（POC 範圍外）

| 項目 | 原因 |
|------|------|
| NoWayLM 後端串接 | POC 直連 Groq API |
| NoWayLM 帳號登入 | POC 不需要認證 |
| Windows 支援 | POC v1 仍先驗證 macOS；UI 設計已定義 Windows fallback（上方置中膠囊 HUD） |
| 靜音偵測自動停止 | POC 用 Fn 放開即停止 |
| 使用者設定頁面 | POC 硬編碼設定 |
| 自動更新 | POC 不需要 |
| 安裝包打包(.dmg) | POC 用 `bun dev` / `cargo tauri dev` 執行 |

---

## 預估開發時間

| 模組 | 工時 |
|------|------|
| Tauri v2 專案初始化 | 0.5 天 |
| Fn 鍵監聽 Rust Plugin | 1 天 |
| 麥克風錄音 | 0.5 天 |
| Groq Whisper API 串接 | 0.5 天 |
| 剪貼簿注入 | 0.5 天 |
| Notch-style 狀態 HUD | 0.5 天 |
| 整合測試 + Debug | 0.5 天 |
| **合計** | **~4 天** |

---

## 驗收檢查清單

- [ ] 按住 Fn 鍵時出現 Boring Notch 風格 HUD（顯示「錄音中」）
- [ ] 放開 Fn 鍵時停止錄音並顯示 HUD「轉錄中」
- [ ] 轉錄完成後 HUD 顯示成功狀態並自動收起
- [ ] 在 Notes.app 中使用 → 文字正確貼入
- [ ] 在 Slack 中使用 → 文字正確貼入
- [ ] 在瀏覽器輸入框中使用 → 文字正確貼入
- [ ] 中文語音辨識結果正確可讀
- [ ] 整體延遲 < 3 秒
- [ ] 首次啟動正確引導 Accessibility 權限

---
---

# V2 功能擴展規劃

**規劃日期：** 2026-02-28
**狀態：** 需求已確認，待進入 BMAD 流程產出 PRD / 架構 / Stories

---

## 競品研究摘要

### VoiceInk（GitHub 4,000+ Stars）

**專案概述：** 原生 macOS 語音轉文字應用，Swift + whisper.cpp，GPL v3.0 授權。

**值得參考的功能：**

| 功能 | VoiceInk 實作 | 我們的決策 |
|------|---------------|-----------|
| 離線辨識 | whisper.cpp 本地推論 + Metal 加速 | 暫不需要，使用 Groq Cloud API |
| 多觸發方式 | 8 種觸發（Fn/Option/Ctrl/Cmd/Shift/自訂鍵/滑鼠中鍵）+ Hold/Toggle | 採納：可配置修飾鍵 + Hold/Toggle |
| AI 增強 | 12+ AI 提供商，自訂 prompt，上下文注入（剪貼簿/選取文字/螢幕擷取） | 採納簡化版：Groq 單一提供商 + 自訂 prompt + 上下文注入 |
| Power Mode | Per-App 設定（依前景 App/瀏覽器 URL 自動切換語言/模型/prompt） | Phase 2+ 再考慮 |
| 個人字典 | SwiftData 持久化，注入 Whisper prompt 引導辨識 | 採納 |
| 文字後處理 | NaturalLanguage 智慧分段 + 語言感知詞替換 + 填充詞移除 | 簡化：統一由 AI prompt 處理 |
| 串流轉錄 | Deepgram/ElevenLabs/Soniox WebSocket 即時轉錄 | Phase 2+ 再考慮 |
| VAD | Silero VAD v5.1.2 GGML 模型 | Phase 2 實作（Web Audio API 方案） |
| 歷史記錄 | SwiftData 持久化，可搜尋回顧 | 採納（SQLite via tauri-plugin-sql） |
| HUD | Notch 模式 + Mini 浮動視窗雙模式 | 現有 Notch，Phase 2 加 Mini 模式 |
| Apple Shortcuts | AppIntents 整合，背景觸發 | 不適用（非原生 App） |
| 多語言 | 90+ 語言可切換 | 不需要，輸出統一繁體中文 |

### Typeless

**專案概述：** 商業語音轉文字桌面 App，有 Dashboard UI、歷史紀錄、字典功能。

**UI 參考價值：**
- 左側 Sidebar 導航（首頁 / 歷史紀錄 / 字典）
- Dashboard 統計卡片（個性化百分比 / 總口述時間 / 口述字數 / 節省時間 / 平均口述速度）
- 設定頁面：鍵盤快捷鍵綁定（口述 / 隨便問 / 翻譯分別綁不同快捷鍵）
- 底部 footer 導航（帳戶 / 信箱 / 設定 / 幫助）

---

## V2 確認需求清單

### 1. 多觸發方式支援（跨平台）

**需求：**
- 使用者可自選觸發用的修飾鍵
- macOS 預設：Fn 鍵
- Windows 預設：右側 Alt 鍵（Right Alt）
- 支援兩種觸發模式：
  - **Hold 模式**（現有）：按住錄音，放開停止
  - **Toggle 模式**（新增）：按兩下開始，再按一下結束 or 靜音自動結束（需搭配 VAD）

**跨平台策略：**
- Rust 端改用 `rdev` crate 統一處理全域鍵盤監聽（取代目前僅 macOS 的 CGEventTap）
- `rdev` 同時支援 macOS / Windows / Linux
- Windows 上 Fn 鍵通常由韌體攔截、OS 層收不到，因此 Windows 預設改用右 Alt

**可選修飾鍵清單：**

| 平台 | 可選項 |
|------|--------|
| macOS | Fn、Option（Alt）、Control、Command、Shift |
| Windows | 右 Alt（預設）、左 Alt、Control、Shift |

### 2. AI 文字整理（轉錄後處理）

**核心概念：** 轉錄完的原始文字直接送給 Groq LLM + 使用者可編輯的 prompt，由 AI 一次完成所有後處理（去口語、分段、標點修正）。不做多階段管線。

**流程：**
```
Whisper 原始文字
    │
    ▼
字數 >= 門檻（~10 字）？
├─ No  → 直接貼上（短指令如「好」「確認」不需要 AI）
└─ Yes → Groq LLM + Prompt 整理
            │
            ▼
       整理後文字 → 貼上
```

**預設 Prompt（使用者可修改）：**
```
你是語音轉文字的後處理助手。請將以下語音轉錄的原始文字整理為通順的繁體中文書面語：
- 移除口語填充詞（嗯、啊、那個、就是、然後、對啊）
- 修正標點符號
- 適當分段（內容較多時）
- 保持原意不變，不添加或刪除實質內容
```

**上下文注入（附加在 system prompt）：**
```xml
<clipboard>使用者剪貼簿當前內容</clipboard>
<vocabulary>使用者自訂詞彙清單</vocabulary>
```

**AI 提供商：** 僅 Groq（已有 API Key 基礎設施）

**HUD 狀態擴展：** 新增 `enhancing` 狀態（AI 整理中）
```
[錄音中] → [轉錄中] → [整理中] → [成功] → [待機]
```

### 3. 自訂詞彙 / 個人字典

**需求：**
- 使用者可維護一份常用詞彙清單（專案名、人名、技術術語、縮寫）
- 詞彙注入 Whisper API 的 `prompt` 參數，引導模型正確辨識特定術語
- 同時注入 AI 整理的上下文，讓 AI 知道正確用詞
- 簡易 CRUD UI（新增、刪除、列表）

**技術實作：**
- 儲存：SQLite（與歷史記錄共用資料庫）
- Whisper API 注入格式：`"Important Vocabulary: 詞彙1, 詞彙2, 詞彙3"`，作為 `prompt` 參數傳入
- AI 上下文注入：`<vocabulary>詞彙1, 詞彙2, 詞彙3</vocabulary>`

### 4. 歷史記錄

**需求：**
- 持久化儲存每次轉錄記錄
- 主要用途：提供 Dashboard 統計資料計算
- 可回顧、搜尋、複製歷史轉錄文字

**資料模型：**
```typescript
interface TranscriptionRecord {
  id: string                       // UUID
  timestamp: number                // Unix ms
  rawText: string                  // Whisper 原始輸出
  processedText: string            // AI 整理後文字（若有）
  language: string                 // 辨識語言（固定 "zh"）
  recordingDurationMs: number      // 錄音時長
  transcriptionDurationMs: number  // Whisper API 回應時長
  enhancementDurationMs?: number   // AI 整理回應時長（若有）
  charCount: number                // 最終輸出字數
  triggerMode: 'hold' | 'toggle'   // 觸發方式
  wasEnhanced: boolean             // 是否經過 AI 整理
}
```

**儲存方案：** `tauri-plugin-sql`（SQLite），跨平台、持久、可查詢

### 5. App UI 介面

**需求：** 新增一個主視窗（Main Window），與現有的 HUD Overlay 分離。

**雙視窗架構：**
```
┌─ HUD Overlay（現有）────────────────────────┐
│  Notch 風格浮動視窗                          │
│  錄音/轉錄/整理/完成狀態顯示                  │
│  始終置頂、不可互動、不可拖動                  │
└─────────────────────────────────────────────┘

┌─ Main Window（新增）────────────────────────┐
│  標準應用程式視窗                             │
│  從 System Tray 點擊開啟                     │
│  包含 Dashboard / 歷史 / 字典 / 設定         │
└─────────────────────────────────────────────┘
```

**頁面結構：**

```
┌─ Sidebar ──┐  ┌─ Content Area ─────────────────────┐
│             │  │                                     │
│  🏠 首頁    │  │  ← 依左側選項切換內容               │
│  📝 歷史    │  │                                     │
│  📖 字典    │  │                                     │
│             │  │                                     │
│  ────────  │  │                                     │
│  ⚙️ 設定    │  │                                     │
│             │  │                                     │
└─────────────┘  └─────────────────────────────────────┘
```

#### 5.1 Dashboard 首頁

**統計卡片（從歷史記錄計算）：**

| 指標 | 計算方式 |
|------|---------|
| 總口述時間 | `sum(recordingDurationMs)` 轉為 hr/min |
| 口述字數 | `sum(charCount)` |
| 平均口述速度 | `total_chars / total_recording_duration`（字/分鐘）|
| 節省時間 | `total_chars / 40`（假設平均打字速度 40 字/min）|
| 總使用次數 | `count(records)` |
| AI 整理使用率 | `count(wasEnhanced=true) / count(total)` % |

**最近轉錄列表：** 顯示最近 5-10 筆轉錄摘要（時間戳 + 文字前 50 字截斷）

#### 5.2 歷史記錄頁

- 完整轉錄記錄列表（分頁或無限捲動）
- 搜尋功能（全文搜尋）
- 每筆記錄可展開查看完整文字
- 複製按鈕

#### 5.3 字典頁

- 詞彙清單（表格或卡片形式）
- 新增詞彙輸入框
- 刪除按鈕
- 詞彙數量統計

#### 5.4 設定頁

**極簡設計，僅三個區塊：**

```
設定
├── ⌨️ 快捷鍵
│   ├── 觸發鍵選擇：下拉選單（Fn / Option / Ctrl...）
│   └── 觸發模式：Hold / Toggle 切換
│
├── 🤖 AI
│   ├── Groq API Key：密碼輸入框
│   └── 整理 Prompt：多行文字編輯區域（附預設值、可重置）
│
└── ℹ️ 關於
    └── 版本資訊
```

**不需要的設定（刻意排除）：**
- ~~介面語言選擇~~（固定繁體中文）
- ~~辨識語言選擇~~（固定中文，輸出統一繁體中文）
- ~~多 AI 提供商切換~~（僅 Groq）
- ~~文字處理開關~~（由 AI prompt 統一控制）
- ~~音訊裝置選擇~~（使用系統預設）
- ~~VAD 靈敏度~~（Phase 2）

### 6. VAD 語音活動偵測（Phase 2）

**需求：**
- 偵測靜音自動停止錄音
- 搭配 Toggle 模式使用：按一下開始 → 說話 → 靜音 N 秒後自動結束並轉錄
- 技術方案：Web Audio API 的 `AnalyserNode` 做音量分析

**Phase 2 範圍，不在 V2 Phase 1 實作。**

---

## V2 技術架構更新

### 更新後的完整流程

```
按住 Fn(mac) / 右Alt(win)
       │
       ▼
  錄音中（HUD 顯示 recording）
       │  放開 / 再按（Toggle）/ 靜音（VAD, Phase 2）
       ▼
  Whisper API 轉錄（HUD 顯示 transcribing）
  （prompt 注入自訂詞彙清單）
       │
       ▼
  字數 >= 門檻（~10字）？
  ├─ No  → 直接貼上
  └─ Yes → Groq LLM + Prompt 整理（HUD 顯示 enhancing）
              │   上下文注入：剪貼簿 + 詞彙清單
              ▼
         整理後文字
       │
       ▼
  貼上到游標位置（HUD 顯示 success）
  同時寫入 SQLite 歷史記錄
       │
       ▼
  HUD 自動收起回 idle
```

### 更新後的技術架構圖

```
+------------------------------------------------------------------+
|  Tauri Desktop App（System Tray 常駐）                             |
|                                                                    |
|  ┌─ Rust Plugin Layer ─────────────────────────────────────────┐  |
|  │                                                             │  |
|  │  [hotkey_listener.rs]  ← rdev crate（跨平台）              │  |
|  │    mac: Fn / Option / Ctrl / Cmd / Shift                   │  |
|  │    win: 右Alt / 左Alt / Ctrl / Shift                       │  |
|  │    模式: Hold / Toggle                                      │  |
|  │                                                             │  |
|  │  [clipboard_paste.rs]  ← arboard crate                     │  |
|  │    備份剪貼簿 → 寫入文字 → 模擬 Cmd+V / Ctrl+V            │  |
|  │                                                             │  |
|  │  [tauri-plugin-sql]    ← SQLite                             │  |
|  │    歷史記錄 + 詞彙字典                                      │  |
|  │                                                             │  |
|  └─────────────────────────────────────────────────────────────┘  |
|                                                                    |
|  ┌─ WebView Layer (Vue 3 + TypeScript + Tailwind) ─────────────┐  |
|  │                                                             │  |
|  │  [HUD Window]          ← 現有 Notch-style Overlay          │  |
|  │    狀態: idle → recording → transcribing → enhancing        │  |
|  │           → success / error → idle                          │  |
|  │                                                             │  |
|  │  [Main Window]         ← 新增應用程式主視窗                 │  |
|  │    Vue Router:                                              │  |
|  │    ├── /dashboard      ← 統計卡片 + 最近轉錄               │  |
|  │    ├── /history        ← 歷史記錄列表                       │  |
|  │    ├── /dictionary     ← 自訂詞彙管理                       │  |
|  │    └── /settings       ← 快捷鍵 / AI / 關於                │  |
|  │                                                             │  |
|  │  [Services]                                                 │  |
|  │    recorder.ts         ← MediaRecorder 錄音                 │  |
|  │    transcriber.ts      ← Groq Whisper API                   │  |
|  │    enhancer.ts         ← Groq LLM AI 整理（新增）           │  |
|  │    historyStore.ts     ← SQLite CRUD + 統計查詢（新增）     │  |
|  │    vocabularyStore.ts  ← SQLite CRUD（新增）                │  |
|  │    settingsStore.ts    ← 設定持久化（新增）                 │  |
|  │                                                             │  |
|  └─────────────────────────────────────────────────────────────┘  |
+------------------------------------------------------------------+
```

### 新增的技術依賴

| 項目 | 選型 | 說明 |
|------|------|------|
| 跨平台熱鍵 | `rdev` crate | 取代 CGEventTap，支援 mac/win/linux |
| 資料庫 | `tauri-plugin-sql` (SQLite) | 歷史記錄 + 詞彙儲存 |
| 前端路由 | `vue-router` | Main Window 頁面切換 |
| 狀態管理 | `pinia` | 全域狀態（設定、歷史、詞彙） |

---

## V2 Phase 規劃

### Phase 1 — 完整功能版（當前目標）

| 模組 | 內容 |
|------|------|
| 基礎架構 | Main Window + Vue Router + SQLite + Pinia |
| 多觸發方式 | rdev 跨平台熱鍵 + Hold/Toggle 模式 |
| AI 文字整理 | Groq LLM + 可編輯 prompt + 上下文注入 + 字數門檻 |
| 自訂詞彙 | CRUD + Whisper prompt 注入 |
| 歷史記錄 | SQLite 持久化 + 統計查詢 |
| App UI | Dashboard / 歷史 / 字典 / 設定四頁 |
| HUD 更新 | 新增 enhancing 狀態 |

### Phase 2 — 體驗優化（未來）

| 模組 | 內容 |
|------|------|
| VAD | Web Audio API 靜音偵測，搭配 Toggle 自動停止 |
| 串流轉錄 | WebSocket 即時字幕 |
| Mini HUD | 適配無瀏海外接螢幕 |
| 剪貼簿還原 | 貼上後延遲還原原始剪貼簿 |

---

## BMAD 流程下一步

本文件作為上下文提供給 BMAD 流程各步驟使用：

1. `/bmad-bmm-create-product-brief` — 產品簡報（基於本文件的需求整理）
2. `/bmad-bmm-create-prd` — 產品需求文件（⚠️ 必要）
3. `/bmad-bmm-create-ux-design` — UX 設計（Dashboard / 設定 / HUD）
4. `/bmad-bmm-create-architecture` — 技術架構文件（⚠️ 必要）
5. `/bmad-bmm-create-epics-and-stories` — Epics & Stories（⚠️ 必要）
