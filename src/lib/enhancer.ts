import { fetch } from "@tauri-apps/plugin-http";
import type { ChatUsageData, EnhanceResult } from "../types/transcription";
import { DEFAULT_LLM_MODEL_ID } from "./modelRegistry";

const GROQ_CHAT_API_URL = "https://api.groq.com/openai/v1/chat/completions";
const ENHANCEMENT_TIMEOUT_MS = 5000;
const MAX_VOCABULARY_TERMS = 100;

export const DEFAULT_SYSTEM_PROMPT = `你是一個繁體中文文字整理助手。請將以下口語轉錄文字整理為通順的書面語。

規則：
- 去除口語贅詞（嗯、那個、就是、然後、其實、基本上等）
- 修正標點符號
- 適當重組句構使文字通順
- 必要時適當分段
- 保持原始語意不變
- 不要添加原文沒有的資訊
- 直接輸出整理後的文字，不要加任何前綴說明`;

export interface EnhanceOptions {
  systemPrompt?: string;
  vocabularyTermList?: string[];
  modelId?: string;
}

interface GroqChatChoice {
  message: {
    content: string;
  };
}

interface GroqChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  prompt_time: number;
  completion_time: number;
  total_time: number;
}

interface GroqChatResponse {
  choices: GroqChatChoice[];
  usage?: GroqChatUsage;
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error("AI 整理逾時")), ms);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

export function buildSystemPrompt(
  basePrompt: string,
  vocabularyTermList?: string[],
): string {
  let prompt = basePrompt;

  if (vocabularyTermList && vocabularyTermList.length > 0) {
    const truncatedTermList = vocabularyTermList.slice(0, MAX_VOCABULARY_TERMS);
    prompt += `\n\n<vocabulary>\n${truncatedTermList.join(", ")}\n</vocabulary>`;
  }

  return prompt;
}

function parseUsage(usage?: GroqChatUsage): ChatUsageData | null {
  if (!usage) return null;
  return {
    promptTokens: usage.prompt_tokens,
    completionTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens,
    promptTimeMs: Math.round(usage.prompt_time * 1000),
    completionTimeMs: Math.round(usage.completion_time * 1000),
    totalTimeMs: Math.round(usage.total_time * 1000),
  };
}

/**
 * 移除 reasoning model（如 Qwen3）回應中的 <think>...</think> 區塊，
 * 只保留最終輸出內容。
 */
export function stripReasoningTags(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

export async function enhanceText(
  rawText: string,
  apiKey: string,
  options?: EnhanceOptions,
): Promise<EnhanceResult> {
  if (!apiKey || apiKey.trim() === "") {
    throw new Error("API Key 未設定");
  }

  const basePrompt = options?.systemPrompt || DEFAULT_SYSTEM_PROMPT;
  const fullPrompt = buildSystemPrompt(basePrompt, options?.vocabularyTermList);

  const body = JSON.stringify({
    model: options?.modelId ?? DEFAULT_LLM_MODEL_ID,
    messages: [
      { role: "system", content: fullPrompt },
      { role: "user", content: rawText },
    ],
    temperature: 0.3,
    max_tokens: 2048,
  });

  const response = await withTimeout(
    fetch(GROQ_CHAT_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body,
    }),
    ENHANCEMENT_TIMEOUT_MS,
  );

  if (!response.ok) {
    let errorBody = "";
    try {
      errorBody = await response.text();
    } catch {
      // ignore
    }
    throw new Error(
      `AI 整理失敗：${response.status} ${response.statusText} — ${errorBody}`,
    );
  }

  const data = (await response.json()) as GroqChatResponse;
  const usage = parseUsage(data.usage);

  if (!data.choices || data.choices.length === 0) {
    return { text: rawText, usage };
  }

  const rawContent = data.choices[0].message.content?.trim();
  if (!rawContent) {
    return { text: rawText, usage };
  }

  const enhancedContent = stripReasoningTags(rawContent);
  return { text: enhancedContent || rawText, usage };
}
