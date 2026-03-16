/**
 * 幻覺偵測模組 — 純函式，不依賴 Vue/Pinia/Tauri。
 *
 * 二層偵測邏輯（純物理信號）：
 *  Layer 1: 語速異常（錄音 < 1 秒但文字 > 10 字）
 *  Layer 2: 無人聲偵測（靜音 / 極低 RMS / 低 RMS + 高 NSP）
 */

// ── 常數 ──

/** Layer 1 錄音時長門檻（ms） */
export const SPEED_ANOMALY_MAX_DURATION_MS = 1000;
/** Layer 1 文字長度門檻 */
export const SPEED_ANOMALY_MIN_CHARS = 10;
/** Layer 2a 靜音峰值能量門檻（0.0 = 完全靜音, 1.0 = 最大音量） */
export const SILENCE_PEAK_ENERGY_THRESHOLD = 0.02;
/** Layer 2b 極低 RMS 門檻 — 低於此值幾乎確定無人聲 */
export const SILENCE_RMS_HARD_THRESHOLD = 0.008;
/** Layer 2c 低 RMS 門檻 — 搭配高 NSP 聯合判斷（人聲 RMS ≥ 0.03，背景噪音 RMS ≈ 0.005~0.02） */
export const SILENCE_RMS_SOFT_THRESHOLD = 0.015;
/** Layer 2c NSP 門檻（Whisper 認為「可能無語音」的信心度） */
export const SILENCE_NSP_THRESHOLD = 0.7;

// ── 型別 ──

export interface HallucinationDetectionParams {
  rawText: string;
  recordingDurationMs: number;
  peakEnergyLevel: number;
  rmsEnergyLevel: number;
  noSpeechProbability: number;
}

export interface HallucinationDetectionResult {
  isHallucination: boolean;
  reason: "speed-anomaly" | "no-speech-detected" | null;
  detectedText: string;
}

// ── 核心函式 ──

/**
 * 二層幻覺偵測邏輯（純物理信號）。
 *
 * Layer 1: 語速異常 — 錄音不到 1 秒但 Whisper 回傳超過 10 字，物理上不可能。
 * Layer 2: 無人聲 — 靜音（peak < 0.02）、極低 RMS（< 0.008）、或低 RMS + 高 NSP 聯合判斷。
 */
export function detectHallucination(
  params: HallucinationDetectionParams,
): HallucinationDetectionResult {
  const {
    rawText,
    recordingDurationMs,
    peakEnergyLevel,
    rmsEnergyLevel,
    noSpeechProbability,
  } = params;
  const trimmedText = rawText.trim();
  const charCount = trimmedText.length;

  // Layer 1: 語速異常（物理定律級判斷）
  if (
    recordingDurationMs < SPEED_ANOMALY_MAX_DURATION_MS &&
    charCount > SPEED_ANOMALY_MIN_CHARS
  ) {
    return {
      isHallucination: true,
      reason: "speed-anomaly",
      detectedText: trimmedText,
    };
  }

  // Layer 2: 無人聲偵測（合併靜音 + 背景噪音判斷）
  // 2a: 完全靜音 — 麥克風確認無任何聲音
  // 2b: 極低 RMS — 幾乎確定無人聲（NSP 可能為 0，Whisper 對幻覺有時很自信）
  // 2c: 低 RMS + 高 NSP — RMS 在灰色地帶但 Whisper 也認為無語音
  if (
    peakEnergyLevel < SILENCE_PEAK_ENERGY_THRESHOLD ||
    rmsEnergyLevel < SILENCE_RMS_HARD_THRESHOLD ||
    (rmsEnergyLevel < SILENCE_RMS_SOFT_THRESHOLD &&
      noSpeechProbability > SILENCE_NSP_THRESHOLD)
  ) {
    return {
      isHallucination: true,
      reason: "no-speech-detected",
      detectedText: trimmedText,
    };
  }

  // 放行
  return {
    isHallucination: false,
    reason: null,
    detectedText: trimmedText,
  };
}
