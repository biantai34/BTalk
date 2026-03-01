import { fetch } from "@tauri-apps/plugin-http";
import type { TranscriptionResult } from "../types";
import { API_KEY_MISSING_ERROR } from "./errorUtils";

const GROQ_API_URL = "https://api.groq.com/openai/v1/audio/transcriptions";

function getFileExtensionFromMime(mimeType: string): string {
  if (mimeType.includes("webm")) return "webm";
  if (mimeType.includes("mp4")) return "mp4";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("wav")) return "wav";
  return "webm";
}

export async function transcribeAudio(
  audioBlob: Blob,
  apiKey: string,
): Promise<TranscriptionResult> {
  if (apiKey.trim() === "") {
    throw new Error(API_KEY_MISSING_ERROR);
  }

  const startTime = performance.now();

  const extension = getFileExtensionFromMime(audioBlob.type);
  const formData = new FormData();
  formData.append("file", audioBlob, `recording.${extension}`);
  formData.append("model", "whisper-large-v3");
  formData.append("language", "zh");
  formData.append("response_format", "text");

  console.log(
    `[transcriber] Sending ${audioBlob.size} bytes (${audioBlob.type}) to Groq API...`,
  );

  const response = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Groq API error (${response.status}): ${errorBody}`);
  }

  const text = (await response.text()).trim();
  const duration = performance.now() - startTime;

  console.log(
    `[transcriber] Got response in ${Math.round(duration)}ms: "${text}"`,
  );

  return { text, duration };
}
