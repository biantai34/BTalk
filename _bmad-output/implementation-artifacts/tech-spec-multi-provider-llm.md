---
title: 'Multi-Provider LLM 支援 + Kimi K2 退場遷移'
slug: 'multi-provider-llm'
created: '2026-03-27 17:34:59'
status: 'implementation-complete'
stepsCompleted: [1, 2, 3, 4]
tech_stack: ['Vue 3 (Composition API, <script setup>)', 'TypeScript', 'Tauri v2', 'Pinia', 'shadcn-vue', 'tauri-plugin-http (fetch)', 'tauri-plugin-store', 'Vitest']
files_to_modify: ['src/lib/modelRegistry.ts', 'src/lib/llmProvider.ts', 'src/lib/enhancer.ts', 'src/lib/vocabularyAnalyzer.ts', 'src/lib/apiPricing.ts', 'src/types/transcription.ts', 'src/stores/useSettingsStore.ts', 'src/stores/useVoiceFlowStore.ts', 'src/stores/useHistoryStore.ts', 'src/views/SettingsView.vue', 'src/views/DashboardView.vue', 'src/i18n/locales/*.json', 'tests/unit/enhancer.test.ts', 'tests/unit/api-pricing.test.ts', 'tests/unit/llmProvider.test.ts']
code_patterns: ['raw fetch via @tauri-apps/plugin-http', 'API key in tauri-plugin-store (not SQLite)', 'model registry as single source of truth', 'DECOMMISSIONED_MODEL_MAP for auto-migration', 'one-time migration flags in store', 'views → stores → lib dependency chain', 'OpenAI-compatible request/response format']
test_patterns: ['Vitest with vi.mock for @tauri-apps/plugin-http', 'dynamic import per test for module isolation', 'mockFetch pattern for API call testing', 'P0/P1 priority labels in test names']
---

# Tech-Spec: Multi-Provider LLM 支援 + Kimi K2 退場遷移

**Created:** 2026-03-27

## Overview

### Problem Statement

Kimi K2（`moonshotai/kimi-k2-instruct`）將於 2026-04-15 被 Groq 下架，目前為專案預設 LLM 模型。此外，應用程式僅支援 Groq 免費模型，使用者無法選用更高品質的付費模型（如 OpenAI GPT-4o、Anthropic Claude）來取得更好的文字整理與字典分析結果。

### Solution

1. **移除 Kimi K2**：從模型清單移除、更新 `DECOMMISSIONED_MODEL_MAP` 遷移映射、變更預設模型
2. **新增 LLM Provider 選擇**：支援 Groq / OpenAI / Anthropic 三個 provider
3. **獨立 API Key 管理**：每個 provider 各自的 API key 欄位，存於 tauri-plugin-store
4. **統一呼叫介面**：新增 `llmProvider.ts` 抽象層 — OpenAI + Groq 共用 OpenAI-compatible 格式，Anthropic 透過 adapter 轉換
5. **Provider-aware 模型清單**：每個 provider 提供各自可用的模型選項

### Scope

**In Scope:**
- 移除 Kimi K2，更新 `DECOMMISSIONED_MODEL_MAP` 和預設模型
- 新增 Provider 選擇（Groq / OpenAI / Anthropic）
- 每個 provider 獨立 API key 欄位（tauri-plugin-store）
- 每個 provider 各自的模型清單
- `enhancer.ts` + `vocabularyAnalyzer.ts` 改為 provider-aware
- Anthropic Messages API adapter
- 移除獨立的「字典分析模型」選擇器（字典分析與 LLM 共用同一模型）
- i18n 更新（5 語系）

**Out of Scope:**
- Whisper 語音轉錄（維持 Groq，不受 provider 選擇影響）
- Streaming 回應
- 自訂 base URL / self-hosted LLM
- 費用追蹤跨 provider 整合

## Context for Development

### Codebase Patterns

- API 呼叫使用 `@tauri-apps/plugin-http` 的 `fetch`（非瀏覽器原生），禁止使用原生 `fetch`
- API key 存於 `tauri-plugin-store`（非 SQLite），目前只有一個 key：`groqApiKey`
- 模型設定集中在 `src/lib/modelRegistry.ts`，為 single source of truth
- `enhancer.ts` 和 `vocabularyAnalyzer.ts` 各自 hardcode `GROQ_CHAT_API_URL`，使用相同的 OpenAI-compatible request pattern
- 兩個檔案各自定義了重複的 `GroqChatResponse` / `GroqChatUsage` 和 `parseUsage`，應統一
- 已有模型下架自動遷移機制（`DECOMMISSIONED_MODEL_MAP` + `getEffectiveLlmModelId()`）
- v0.8.7 有一次性遷移 pattern（`llmMigratedToKimiK2` flag in store）
- API key 透過參數傳遞（`settingsStore.getApiKey()` → voiceFlowStore → `enhanceText(rawText, apiKey, options)`），lib 層不讀 store
- `VocabularyAnalysisModelId` 獨立於 `LlmModelId`，有自己的清單和選擇器 — 移除 Kimi K2 後僅剩 Llama 3.3 一個選項，本次簡化為共用 LLM 模型
- Settings UI 用 shadcn-vue `Card` + `Select` + `Input` + `RadioGroup` 元件
- 依賴方向：views → stores → lib，views 不可直接 import lib
- i18n：5 個語系檔案（`zh-TW.json`, `en.json`, `ja.json`, `zh-CN.json`, `ko.json`），key 結構如 `settings.apiKey.title`

### Files to Reference

| File | Purpose | 修改類型 |
| ---- | ------- | ------- |
| `src/lib/modelRegistry.ts` | 模型 ID 型別、清單、預設值、遷移映射 | 重構 |
| `src/lib/llmProvider.ts` | **新增** — Provider 抽象層、Anthropic adapter | 新增 |
| `src/lib/enhancer.ts` | 文字整理 LLM 呼叫 | 重構 |
| `src/lib/vocabularyAnalyzer.ts` | 字典分析 LLM 呼叫 | 重構 |
| `src/lib/apiPricing.ts` | 費用計算 | 小修 |
| `src/stores/useSettingsStore.ts` | API key 存取、模型選擇、遷移邏輯 | 重構 |
| `src/views/SettingsView.vue` | 設定 UI | 重構 |
| `src/i18n/locales/*.json` | i18n 翻譯 | 新增 keys |
| `tests/unit/enhancer.test.ts` | enhancer 測試 | 更新 |
| `tests/unit/api-pricing.test.ts` | 費用計算測試 | 更新 |
| `src/types/transcription.ts` | `ChatUsageData` 型別定義 | 小修（時間欄位改 optional） |
| `src/stores/useVoiceFlowStore.ts` | LLM 呼叫端（apiKey + modelId 傳遞） | 更新呼叫 |
| `src/stores/useHistoryStore.ts` | api_usage SQL 寫入（usage 時間欄位） | 小修 |
| `src/views/DashboardView.vue` | 免費額度顯示（freeQuotaRpd/Tpd） | 修正 div-by-zero |
| `tests/unit/llmProvider.test.ts` | **新增** — provider 測試 | 新增 |

### Technical Decisions

1. **Groq + OpenAI 共用 OpenAI-compatible 格式**
   - 兩者都用 `/v1/chat/completions`，差異只在 base URL 和 API key
   - Groq: `https://api.groq.com/openai/v1/chat/completions`
   - OpenAI: `https://api.openai.com/v1/chat/completions`
   - 兩者都用 `Authorization: Bearer <key>` header

2. **Anthropic Messages API adapter**
   - URL: `https://api.anthropic.com/v1/messages`
   - Auth: `x-api-key: <key>`（非 Bearer token）
   - 額外 header: `anthropic-version`（實作時查官方文件確認當前穩定版本，`2023-06-01` 已過舊，不支援新模型）
   - Request: `{ model, max_tokens, messages }` — `max_tokens` 為必填；`temperature: 0` 需驗證是否可用（如不行則用 `0.01`）
   - Response: `{ content: [{ type: "text", text }], usage: { input_tokens, output_tokens } }`
   - 無 `prompt_time` / `completion_time` 等 Groq-specific 欄位

3. **API key 儲存方案**
   - `groqApiKey`（沿用，Whisper + Groq LLM 共用）
   - `openaiApiKey`（新增）
   - `anthropicApiKey`（新增）

4. **Provider → Model 兩階段選擇**
   - 使用者先選 provider，再選該 provider 的模型
   - 切換 provider 時自動重設為該 provider 的預設模型
   - OpenAI / Anthropic 選後需輸入對應 API key

5. **字典分析模型簡化**
   - 移除獨立的 `VocabularyAnalysisModelId` 和 `VOCABULARY_ANALYSIS_MODEL_LIST`
   - 字典分析改用選定的 LLM 模型（共用 provider 和 model）
   - 原因：移除 Kimi K2 後僅剩一個選項；付費模型皆具備 JSON 能力

6. **Kimi K2 遷移策略**
   - 加入 `DECOMMISSIONED_MODEL_MAP`: `"moonshotai/kimi-k2-instruct" → "llama-3.3-70b-versatile"`
   - 更新原本映射到 Kimi K2 的舊模型（GPT OSS 等）→ 新預設
   - 新預設 LLM: `llama-3.3-70b-versatile`
   - 一次性遷移 flag: `llmMigratedFromKimiK2`

7. **`parseUsage` 統一化**
   - `enhancer.ts` 和 `vocabularyAnalyzer.ts` 有重複的 `GroqChatResponse`/`parseUsage`
   - 統一到 `llmProvider.ts` 的 `parseProviderResponse()` — 各 provider usage 格式個別適配
   - `LlmUsageData` 型別：`promptTimeMs` / `completionTimeMs` / `totalTimeMs` 改為 optional（Groq only）

## Implementation Plan

### Tasks

- [x] **Task 1: 更新 `src/lib/modelRegistry.ts` — 型別與資料結構**
  - File: `src/lib/modelRegistry.ts`
  - Action:
    1. 新增 `LlmProviderId` type: `"groq" | "openai" | "anthropic"`
    2. 在 `LlmModelConfig` interface 新增 `providerId: LlmProviderId` 欄位
    3. 更新 `LlmModelId` union type：移除 `"moonshotai/kimi-k2-instruct"`，新增 `"gpt-4o"`, `"gpt-4o-mini"`, `"claude-sonnet-4-20250514"`, `"claude-haiku-4-5-20251001"`
    4. 移除 `VocabularyAnalysisModelId` type、`VocabularyAnalysisModelConfig` interface、`VOCABULARY_ANALYSIS_MODEL_LIST`、`findVocabularyAnalysisModelConfig()`、`getEffectiveVocabularyAnalysisModelId()`、`DEFAULT_VOCABULARY_ANALYSIS_MODEL_ID`
    5. 更新 `DEFAULT_LLM_MODEL_ID` 為 `"llama-3.3-70b-versatile"`
    6. 新增 `DEFAULT_LLM_PROVIDER_ID: LlmProviderId = "groq"`
    7. 為每個既有 Groq 模型加上 `providerId: "groq"`
    8. 新增 OpenAI 模型到 `LLM_MODEL_LIST`：
       - `{ id: "gpt-4o", providerId: "openai", displayName: "GPT-4o", badgeKey: "settings.modelBadge.premium", speedTps: 0, inputCostPerMillion: TBD, outputCostPerMillion: TBD, freeQuotaRpd: 0, freeQuotaTpd: 0, isDefault: true }`
       - `{ id: "gpt-4o-mini", providerId: "openai", displayName: "GPT-4o Mini", badgeKey: "settings.modelBadge.fastCheap", ... isDefault: false }`
    9. 新增 Anthropic 模型到 `LLM_MODEL_LIST`：
       - `{ id: "claude-sonnet-4-20250514", providerId: "anthropic", displayName: "Claude Sonnet 4", badgeKey: "settings.modelBadge.premium", ... isDefault: true }`
       - `{ id: "claude-haiku-4-5-20251001", providerId: "anthropic", displayName: "Claude Haiku 4.5", badgeKey: "settings.modelBadge.fastCheap", ... isDefault: false }`
    10. 移除 Kimi K2 從 `LLM_MODEL_LIST`
    11. 更新 `DECOMMISSIONED_MODEL_MAP`：
        - 新增 `"moonshotai/kimi-k2-instruct": "llama-3.3-70b-versatile"`
        - 修改原本映射到 Kimi K2 的 entries（`"qwen-qwq-32b"`, `"gpt-oss-120b"`, `"openai/gpt-oss-120b"`, `"openai/gpt-oss-20b"`）→ `"llama-3.3-70b-versatile"`
    12. 新增 helper: `getModelListByProvider(providerId: LlmProviderId): LlmModelConfig[]`
    13. 新增 helper: `getDefaultModelIdForProvider(providerId: LlmProviderId): LlmModelId`
  - Notes:
    - OpenAI/Anthropic 定價與模型 ID 需從官方文件確認，spec 中標為 TBD
    - `freeQuotaRpd` / `freeQuotaTpd` 對付費 provider 設為 0
    - `speedTps` 對付費 provider 設為 0（官方不公開此數據）
    - `isDefault` 語意改為「此 provider 的預設模型」— 既有 Groq 模型的 `isDefault` 需更新：`qwen/qwen3-32b` 改為 `false`，`llama-3.3-70b-versatile` 改為 `true`（因 Qwen3 在 Groq 為 Preview 狀態，不適合作為預設）
    - 新增 `settings.modelBadge.premium` i18n key

- [x] **Task 2: 新增 `src/lib/llmProvider.ts` — Provider 抽象層**
  - File: `src/lib/llmProvider.ts`（新增）
  - Action:
    1. Import `LlmProviderId` 和 `findLlmModelConfig` from `./modelRegistry`
    2. 定義 `LlmProviderConfig` interface：
       ```
       id: LlmProviderId
       displayName: string
       baseUrl: string
       consoleUrl: string         // 取得 API key 的網址
       apiKeyPrefix: string       // API key 前綴提示（如 "sk-"、"gsk_"），用於 input placeholder
       ```
    3. 定義 `LLM_PROVIDER_LIST: LlmProviderConfig[]`：
       - Groq: baseUrl `https://api.groq.com/openai/v1/chat/completions`, storeKeyName `groqApiKey`, consoleUrl `https://console.groq.com/keys`
       - OpenAI: baseUrl `https://api.openai.com/v1/chat/completions`, storeKeyName `openaiApiKey`, consoleUrl `https://platform.openai.com/api-keys`
       - Anthropic: baseUrl `https://api.anthropic.com/v1/messages`, storeKeyName `anthropicApiKey`, consoleUrl `https://console.anthropic.com/settings/keys`
    4. 定義統一型別：
       - `LlmChatMessage { role: "system" | "user" | "assistant"; content: string }`
       - `LlmChatRequest { model: string; messages: LlmChatMessage[]; temperature?: number; maxTokens?: number }`
       - `LlmUsageData { promptTokens: number; completionTokens: number; totalTokens: number; promptTimeMs?: number; completionTimeMs?: number; totalTimeMs?: number }` — 時間欄位 optional（Groq only）
       - `LlmChatResult { text: string; usage: LlmUsageData | null }`
    5. 實作 `buildFetchParams(providerId: LlmProviderId, request: LlmChatRequest, apiKey: string): { url: string; init: RequestInit }`：
       - Groq / OpenAI：標準 OpenAI body（`{ model, messages, temperature, max_tokens }`）、`Authorization: Bearer` header
       - Anthropic：轉換 messages 格式（提取 system message 到頂層 `system` 欄位）、`x-api-key` header、`anthropic-version` header（實作時查官方文件確認版本）、`temperature` 驗證（如 Anthropic 不接受 `0` 則用 `0.01`）、`max_tokens` 必填（若呼叫端未傳則預設 `2048`）
    6. 實作 `parseProviderResponse(providerId: LlmProviderId, json: unknown): LlmChatResult`：
       - Groq / OpenAI：`choices[0].message.content`、usage 含時間欄位（Groq）或不含（OpenAI）
       - Anthropic：`content[0].text`、`usage.input_tokens` / `usage.output_tokens`
    7. Export helper: `findProviderConfig(providerId: LlmProviderId): LlmProviderConfig | undefined`
  - Notes:
    - 使用 `@tauri-apps/plugin-http` 的 `fetch`
    - Anthropic system message 處理：如果 messages 陣列第一個是 `role: "system"`，提取為 Anthropic request 的頂層 `system` 欄位，剩餘 messages 只含 `user` / `assistant`
    - Anthropic `max_tokens` 為必填欄位 — `buildFetchParams` 在 provider 為 Anthropic 時，若 `request.maxTokens` 未提供則強制帶 `2048`
    - 新增 `PROVIDER_TIMEOUT_MS` 常數映射：Groq `5000`、OpenAI `30000`、Anthropic `30000`
    - Export `getProviderTimeout(providerId: LlmProviderId): number` helper

- [x] **Task 3: 重構 `src/lib/enhancer.ts` — 使用 provider 抽象層**
  - File: `src/lib/enhancer.ts`
  - Action:
    1. 移除 `GROQ_CHAT_API_URL` 常數
    2. 移除 `GroqChatChoice`、`GroqChatUsage`、`GroqChatResponse` interface
    3. 移除 `parseUsage()` 函式
    4. Import `buildFetchParams`, `parseProviderResponse`, `LlmChatRequest`, `LlmUsageData` from `./llmProvider`
    5. Import `findLlmModelConfig` from `./modelRegistry`
    6. 更新 `EnhanceOptions`：移除 `modelId?: string`，新增 `modelId: string`（呼叫端必須提供，由 store 傳入）
    7. 更新 `enhanceText()` 實作：
       - 從 `findLlmModelConfig(modelId)` 取得 `providerId`，**null-check**：`findLlmModelConfig(modelId)?.providerId ?? "groq"`（防止 store 殘留無效 modelId）
       - 使用 `buildFetchParams()` 組裝 request
       - 使用 `parseProviderResponse()` 解析 response
       - 保留 `stripReasoningTags()` 處理（對 OpenAI/Anthropic 無害）
       - 更新 `withTimeout()`：改用 `getProviderTimeout(providerId)` 取代 hardcoded `ENHANCEMENT_TIMEOUT_MS`
       - 保留 `EnhancerApiError` 錯誤處理
    8. 更新 `ChatUsageData` type（`src/types/transcription.ts`）：`promptTimeMs` / `completionTimeMs` / `totalTimeMs` 改為 optional
  - Notes:
    - `enhanceText()` 的 signature 變更最小化：`(rawText, apiKey, options)` 維持不變
    - `options.modelId` 改為必填，但給 fallback `DEFAULT_LLM_MODEL_ID`
    - 呼叫端（voiceFlowStore）已經傳 `modelId: settingsStore.selectedLlmModelId`

- [x] **Task 4: 重構 `src/lib/vocabularyAnalyzer.ts` — 使用 provider 抽象層**
  - File: `src/lib/vocabularyAnalyzer.ts`
  - Action:
    1. 移除 `GROQ_CHAT_API_URL` 常數
    2. 移除 `GroqChatUsage`、`GroqChatResponse` interface
    3. 移除 `parseUsage()` 函式
    4. Import `buildFetchParams`, `parseProviderResponse`, `LlmChatRequest` from `./llmProvider`
    5. Import `findLlmModelConfig` from `./modelRegistry`
    6. 更新 `analyzeCorrections()` 實作：
       - 從 `findLlmModelConfig(modelId)` 取得 `providerId`，**null-check**：`?.providerId ?? "groq"`
       - 使用 `buildFetchParams()` / `parseProviderResponse()`
    7. 更新 `ApiUsageInfo` type：`promptTimeMs` / `completionTimeMs` / `totalTimeMs` 改為 optional
  - Notes:
    - `SYSTEM_PROMPT` 不變，但需確認 Anthropic 對 JSON-only 回應的表現
    - 如果 Anthropic 回應帶有額外文字，`parseSuggestedTermList()` 的 fallback regex 已能處理

- [x] **Task 5: 更新 `src/lib/apiPricing.ts`**
  - File: `src/lib/apiPricing.ts`
  - Action:
    1. 移除 `findVocabularyAnalysisModelConfig` import
    2. 更新 `calculateChatCostCeiling()` fallback：只用 `findLlmModelConfig(modelId)`
    3. 更新 fallback cost 常數（原本是 Llama 3.3 70B 的 `$0.79/M`，保持不變）
  - Notes: 小修，主要是移除 vocab model 查找的 fallback

- [x] **Task 6: 重構 `src/stores/useSettingsStore.ts` — Multi-provider 支援**
  - File: `src/stores/useSettingsStore.ts`
  - Action:
    1. 新增 imports: `LlmProviderId`, `DEFAULT_LLM_PROVIDER_ID`, `getModelListByProvider`, `getDefaultModelIdForProvider` from modelRegistry; `findProviderConfig` from llmProvider
    2. 新增 state:
       - `selectedLlmProviderId = ref<LlmProviderId>(DEFAULT_LLM_PROVIDER_ID)`
       - `openaiApiKey = ref<string>("")`
       - `anthropicApiKey = ref<string>("")`
    3. 移除 state: `selectedVocabularyAnalysisModelId`
    4. 新增 computed:
       - `hasLlmApiKey`: 根據 `selectedLlmProviderId` 回傳對應 key 是否已設定
    5. 新增函式:
       - `getLlmApiKey(): string` — 根據 provider 回傳正確的 API key
       - `saveLlmProvider(providerId: LlmProviderId)` — 切換 provider 時重設模型為該 provider 預設
       - `saveOpenaiApiKey(key: string)` / `deleteOpenaiApiKey()`
       - `saveAnthropicApiKey(key: string)` / `deleteAnthropicApiKey()`
       - `refreshLlmApiKey()` — 從 store 重新載入對應 provider 的 key
    6. 更新 `loadSettings()`:
       - 讀取 `llmProviderId` from store（預設 `"groq"`）
       - 讀取 `openaiApiKey` / `anthropicApiKey` from store
       - 移除 `vocabularyAnalysisModelId` 的讀取邏輯
    7. 更新遷移邏輯:
       - Kimi K2 一次性遷移：如果 `llmModelId` 是 `"moonshotai/kimi-k2-instruct"`，強制改為 `"llama-3.3-70b-versatile"`，設 flag `llmMigratedFromKimiK2`
       - 如果沒有 `llmProviderId`（舊版升級），自動設為 `"groq"`
    8. 更新 `getApiKey()` → 保留（回傳 Groq key，供 Whisper 使用）
    9. 移除: `selectedVocabularyAnalysisModelId` 相關函式（`saveVocabularyAnalysisModel` 等）
    10. 更新 return object: 新增 expose 的 state 和函式
  - Notes:
    - `getApiKey()` 繼續回傳 Groq key（供 Whisper transcription 用）
    - `getLlmApiKey()` 回傳 provider-specific key（供 enhancement / vocab analysis 用）
    - 切換 provider 時 model 自動重設，避免 model ID 跨 provider 錯位

- [x] **Task 7: 更新 voiceFlowStore 呼叫端**
  - File: `src/stores/useVoiceFlowStore.ts`
  - Action:
    1. 搜尋所有 `settingsStore.getApiKey()` 用於 LLM 的地方，改為 `settingsStore.getLlmApiKey()`
    2. 保留 `settingsStore.getApiKey()` 用於 Whisper（傳給 Rust `transcribe_audio`）的地方
    3. 搜尋 `settingsStore.selectedVocabularyAnalysisModelId`，替換為 `settingsStore.selectedLlmModelId`
    4. 搜尋 `settingsStore.refreshApiKey()` 用於 LLM 前的地方，改為 `settingsStore.refreshLlmApiKey()`
  - Notes:
    - voiceFlowStore 中有 3 處取 apiKey：2 處 for LLM（enhancement + retranscribe），1 處 for correction detection
    - correction detection 也用 LLM，應改用 `getLlmApiKey()`
    - Whisper transcription apiKey 保持 `getApiKey()`（Groq key）
    - **新增 pre-flight check**：在 enhancement path（`executeMainFlow` / `executeRetranscribeFlow`）中，呼叫 `enhanceText()` 前加入 `if (!settingsStore.hasLlmApiKey)` 檢查，顯示 provider-specific 錯誤訊息（如「OpenAI API Key 未設定」）

- [x] **Task 8: 新增 i18n keys**
  - Files: `src/i18n/locales/zh-TW.json`, `en.json`, `ja.json`, `zh-CN.json`, `ko.json`
  - Action:
    1. 新增 `settings.provider` 區塊：
       - `title`: "LLM 模型服務" / "LLM Provider"
       - `description`: 說明文字
       - `groq`: "Groq（免費）" / "Groq (Free)"
       - `openai`: "OpenAI"
       - `anthropic`: "Anthropic"
       - `groqNote`: "使用上方 Groq API Key" / "Uses Groq API Key above"
    2. 新增 `settings.providerApiKey` 區塊：
       - `openaiTitle`: "OpenAI API Key"
       - `anthropicTitle`: "Anthropic API Key"
       - `openaiInstruction`: "前往 OpenAI Platform 取得 API Key"
       - `anthropicInstruction`: "前往 Anthropic Console 取得 API Key"
       - `goToOpenai`: "前往 OpenAI Platform"
       - `goToAnthropic`: "前往 Anthropic Console"
       - 複用既有的 `settings.apiKey.saved` / `deleted` / `show` / `hide` / `confirmDelete` / `delete`
    3. 新增 provider-specific 錯誤 i18n keys：
       - `errors.openaiApiKeyNotSet`: "OpenAI API Key 未設定" / "OpenAI API Key not set"
       - `errors.anthropicApiKeyNotSet`: "Anthropic API Key 未設定" / "Anthropic API Key not set"
       - `errors.providerAuthFailed`: "API Key 驗證失敗（{provider}）" / "API Key authentication failed ({provider})"
    4. 新增 `settings.modelBadge.premium`: "高品質" / "Premium"
    4. 更新 `settings.apiKey.title`: "Groq API Key" → "Groq API Key（語音轉錄）"
    5. 更新 `settings.apiKey.instruction`: 說明此 key 主要用於語音轉錄
    6. 移除 `settings.model.llmLabel` 相關描述中的字典分析提及
    7. 移除 `settings.smartDictionary.analysisModelDescription` 等不再需要的 key
  - Notes: 5 個語系都要更新，確保一致

- [x] **Task 9: 重構 `src/views/SettingsView.vue` — Provider 選擇 UI**
  - File: `src/views/SettingsView.vue`
  - Action:
    1. **Import 更新**：新增 `LLM_PROVIDER_LIST` / `findProviderConfig` / `getModelListByProvider` import；移除 `VOCABULARY_ANALYSIS_MODEL_LIST` / `findVocabularyAnalysisModelConfig` import
    2. **新增 Provider 選擇 UI**（在「模型選擇」Card 中，LLM 模型 selector 之前）：
       - `RadioGroup` 三選一：Groq / OpenAI / Anthropic
       - 每個 radio 顯示 provider name + 簡短說明
       - Groq radio 旁顯示「（免費）」badge
       - 切換 provider 呼叫 `settingsStore.saveLlmProvider()`
    3. **新增條件式 API Key 區塊**（Provider 選擇下方，模型選擇上方）：
       - `v-if="selectedProvider === 'openai'"` 顯示 OpenAI API Key 輸入
       - `v-if="selectedProvider === 'anthropic'"` 顯示 Anthropic API Key 輸入
       - `v-if="selectedProvider === 'groq'"` 顯示「使用上方 Groq API Key」提示
       - API Key 輸入複用既有的 Input + show/hide toggle + save/delete pattern
       - 含各 provider 的 console 連結
    4. **更新 LLM 模型 selector**：
       - `v-for="model in providerModelList"` — 用 computed 依 provider 過濾
       - 切換 provider 時 model selector 自動重設
    5. **移除 Vocabulary Analysis Model selector**（在「智慧字典學習」Card 中）：
       - 移除 `vocabularyAnalysisModelDescription` computed
       - 移除對應的 `<Select>` 和描述文字
       - 移除 `handleVocabularyAnalysisModelChange` 函式
    6. **更新既有 Groq API Key Card**：
       - 標題補充說明主要用於語音轉錄
       - instruction 文字更新
    7. **新增 computed/ref**：
       - `selectedProvider = computed(() => settingsStore.selectedLlmProviderId)`
       - `providerModelList = computed(() => getModelListByProvider(selectedProvider.value))`
       - `openaiApiKeyInput = ref("")`, `anthropicApiKeyInput = ref("")`
       - `isOpenaiApiKeyVisible`, `isAnthropicApiKeyVisible` 等 UI state
    8. **新增 handler 函式**：
       - `handleProviderChange(providerId)`
       - `handleSaveOpenaiApiKey()` / `handleDeleteOpenaiApiKey()`
       - `handleSaveAnthropicApiKey()` / `handleDeleteAnthropicApiKey()`
  - Notes:
    - 維持 shadcn-vue 元件規範（RadioGroup, Input, Button, Badge, Select）
    - 維持語意色彩（不用 hardcoded colors）
    - RadioGroup `@update:model-value` payload 型別為 `AcceptableValue`，需 runtime narrowing

- [x] **Task 10: 更新測試**
  - Files: `tests/unit/enhancer.test.ts`, `tests/unit/api-pricing.test.ts`, `tests/unit/llmProvider.test.ts`（新增）
  - Action:
    1. **`enhancer.test.ts`**：
       - 更新 modelRegistry mock：移除 Kimi K2，新增 provider fields
       - 更新 URL 驗證：不再 hardcode Groq URL，改驗呼叫了 `buildFetchParams`（或 mock llmProvider）
       - 更新 `body.model` 驗證：改為新預設 `"llama-3.3-70b-versatile"`
       - 測試 Anthropic provider 時的 header 和 body 格式
    2. **`api-pricing.test.ts`**：
       - 更新預設模型相關測試的期望值（Kimi K2 → Llama 3.3 70B）
       - 移除 `findVocabularyAnalysisModelConfig` mock
    3. **`llmProvider.test.ts`**（新增）：
       - `[P0] buildFetchParams — Groq：正確 URL、Bearer auth、OpenAI body`
       - `[P0] buildFetchParams — OpenAI：正確 URL、Bearer auth、OpenAI body`
       - `[P0] buildFetchParams — Anthropic：正確 URL、x-api-key header、anthropic-version header、system message 提取、temperature >= 0.01`
       - `[P0] parseProviderResponse — Groq：choices[0].message.content、usage 含時間`
       - `[P0] parseProviderResponse — OpenAI：choices[0].message.content、usage 不含時間`
       - `[P0] parseProviderResponse — Anthropic：content[0].text、input_tokens/output_tokens`
       - `[P1] parseProviderResponse — 空 choices/content 回傳空字串`
       - `[P1] buildFetchParams — Anthropic temperature 0 修正為 0.01`
  - Notes: 沿用既有 `vi.mock` + dynamic import pattern

- [x] **Task 11: 更新 `src/types/transcription.ts` 及下游 usage 消費端**
  - Files: `src/types/transcription.ts`, `src/stores/useHistoryStore.ts`
  - Action:
    1. `src/types/transcription.ts`：`ChatUsageData` 的 `promptTimeMs` / `completionTimeMs` / `totalTimeMs` 改為 `number | undefined`
    2. `src/stores/useHistoryStore.ts`：`INSERT_API_USAGE_SQL` 寫入時，對 optional 時間欄位用 `?? null`（SQL NULL）
    3. `src/stores/useVoiceFlowStore.ts`：`addApiUsage()` 呼叫處，確認 `chatUsage.promptTimeMs` 存取加 optional chaining
  - Notes: F3 修正 — ChatUsageData type change 的下游影響必須全部追蹤

- [x] **Task 12: 修正 `src/views/DashboardView.vue` — 付費 provider 免費額度 div-by-zero**
  - File: `src/views/DashboardView.vue`
  - Action:
    1. 讀取 Dashboard 中計算 LLM 免費額度進度條的 computed
    2. 當 `freeQuotaRpd === 0` 或 `freeQuotaTpd === 0` 時（付費 provider），隱藏免費額度進度條或顯示「付費方案 — 無免費額度限制」提示
    3. 避免 `usage / 0` 產生 `NaN` / `Infinity`
  - Notes: F4 修正 — OpenAI/Anthropic 模型的 `freeQuotaRpd`/`freeQuotaTpd` 為 0，直接除會爆

### Acceptance Criteria

- [x] **AC 1**: Given Kimi K2 已從模型清單移除, when 舊版使用者升級（store 中 `llmModelId` 為 `"moonshotai/kimi-k2-instruct"`）, then 自動遷移為 `"llama-3.3-70b-versatile"` 且 provider 設為 `"groq"`
- [x] **AC 2**: Given 使用者在設定頁選擇 provider 為 "OpenAI", when 尚未輸入 OpenAI API Key, then LLM 模型下拉顯示 OpenAI 模型清單，且 API Key 輸入欄位顯示
- [x] **AC 3**: Given 使用者已輸入 OpenAI API Key 並選擇 `gpt-4o`, when 執行語音轉文字 + 文字整理, then 語音轉錄仍使用 Groq Whisper API，文字整理使用 OpenAI `gpt-4o` API，回傳整理後文字
- [x] **AC 4**: Given 使用者選擇 Anthropic provider 並輸入 API Key 選擇 Claude Sonnet 4, when 執行文字整理, then request 使用 `https://api.anthropic.com/v1/messages`、`x-api-key` header、正確的 Messages API body 格式
- [x] **AC 5**: Given 使用者選擇 Anthropic provider, when 文字整理回應返回, then 正確解析 Anthropic 格式（`content[0].text`）並顯示整理後文字
- [x] **AC 6**: Given 使用者切換 provider 從 OpenAI 到 Groq, when 切換完成, then LLM 模型重設為 Groq 預設模型（`llama-3.3-70b-versatile`），不顯示額外 API Key 輸入
- [x] **AC 7**: Given 使用者使用 OpenAI provider, when 字典分析偵測到修正, then 字典分析也使用 OpenAI API（與 LLM 相同 provider + model + key）
- [x] **AC 8**: Given Groq API Key 已設定但 OpenAI API Key 未設定, when 使用者選擇 OpenAI provider 並嘗試整理文字, then 顯示「OpenAI API Key 未設定」錯誤
- [x] **AC 9**: Given 使用者刪除 Anthropic API Key, when 回到 Groq provider, then 原有 Groq 功能正常運作，Anthropic key 欄位已清空
- [x] **AC 10**: Given 各 provider API 回傳錯誤（401/429/500）, when 發生錯誤, then 正確拋出 `EnhancerApiError` 並顯示錯誤訊息
- [x] **AC 11**: Given 使用者選擇 OpenAI provider 且 `gpt-4o` 回應耗時 8 秒, when 文字整理進行中, then 不觸發 timeout（OpenAI/Anthropic timeout 為 30s），正常回傳結果
- [x] **AC 12**: Given 使用者選擇付費 provider（OpenAI/Anthropic）, when 開啟 Dashboard, then 免費額度進度條不顯示（或顯示「付費方案」提示），不出現 NaN/Infinity
- [x] **AC 13**: Given OpenAI/Anthropic 模型已加入 registry, when 查詢模型定價, then `inputCostPerMillion` 和 `outputCostPerMillion` 為非零正數

## Additional Context

### Dependencies

- 無新增 npm 套件 — 使用 raw `fetch`（`@tauri-apps/plugin-http`）直接呼叫各 provider API
- Anthropic API 版本: 實作時查官方文件確認當前穩定版本（`2023-06-01` 過舊，不支援新模型 ID）
- OpenAI model IDs 與定價需從官方文件確認（實作時驗證）
- Anthropic model IDs 與定價需從官方文件確認（實作時驗證）

### Testing Strategy

**單元測試：**
- `llmProvider.test.ts`（新增）— buildFetchParams / parseProviderResponse 各 provider 覆蓋
- `enhancer.test.ts`（更新）— 驗證新 provider 抽象層整合
- `api-pricing.test.ts`（更新）— 預設模型變更後的數值驗證

**手動測試：**
- Groq provider → 文字整理 → 確認使用 Groq API
- OpenAI provider → 輸入 key → 文字整理 → 確認使用 OpenAI API
- Anthropic provider → 輸入 key → 文字整理 → 確認使用 Anthropic API
- 切換 provider → 確認模型列表更新
- 刪除 API Key → 確認錯誤提示
- 升級模擬：將 store 中 llmModelId 設為 `"moonshotai/kimi-k2-instruct"` → 確認自動遷移

### Notes

**High-Risk Items：**
- Anthropic Messages API 的 system message 處理方式不同（頂層 `system` 欄位 vs messages 陣列中的 `role: "system"`），adapter 需仔細測試
- Anthropic API version 必須使用支援目標模型的版本（`2023-06-01` 不支援 Claude 4.x），實作時查官方文件
- Anthropic `temperature: 0` — 需實測確認是否可用，如不行則 adapter 中轉為 `0.01`
- Anthropic `max_tokens` 為必填，`buildFetchParams` 在 Anthropic 未傳時強制帶 `2048`
- `DashboardView.vue` 免費額度計算會因 `freeQuotaRpd = 0` 而 div-by-zero，必須處理

**Known Limitations：**
- OpenAI/Anthropic 不提供 Groq 式的 `prompt_time` / `completion_time`，usage 顯示會少這些資訊
- 費用追蹤目前只顯示 Groq 格式，跨 provider 費用追蹤為 out of scope

**Future Considerations（Out of Scope）：**
- 自訂 base URL 支援（self-hosted LLM）
- Streaming 回應以提升使用者感受
- 付費 API 429 rate-limit retry with backoff
- 付費 API 較慢時的 UI 進度回饋（目前 HUD 只有簡單的 "enhancing" 狀態）
- Anthropic model ID 版本策略（日期戳模型會定期被替換，需加入 DECOMMISSIONED_MODEL_MAP）
