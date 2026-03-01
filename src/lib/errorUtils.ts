export function extractErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export const API_KEY_MISSING_ERROR =
  "API Key 未設定，請至設定頁面輸入 Groq API Key";
