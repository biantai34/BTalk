import { describe, it, expect } from "vitest";
import {
  detectHallucination,
  SPEED_ANOMALY_MAX_DURATION_MS,
  SPEED_ANOMALY_MIN_CHARS,
  SILENCE_PEAK_ENERGY_THRESHOLD,
  SILENCE_RMS_HARD_THRESHOLD,
  SILENCE_RMS_SOFT_THRESHOLD,
  SILENCE_NSP_THRESHOLD,
} from "../../src/lib/hallucinationDetector";

/** 正常語音的預設參數（Layer 1/2 都不觸發） */
const NORMAL_DEFAULTS = {
  rmsEnergyLevel: 0.1,
  noSpeechProbability: 0.1,
};

describe("hallucinationDetector.ts", () => {
  describe("常數值驗證", () => {
    it("[P0] 常數應符合設計規格", () => {
      expect(SPEED_ANOMALY_MAX_DURATION_MS).toBe(1000);
      expect(SPEED_ANOMALY_MIN_CHARS).toBe(10);
      expect(SILENCE_PEAK_ENERGY_THRESHOLD).toBe(0.02);
      expect(SILENCE_RMS_HARD_THRESHOLD).toBe(0.008);
      expect(SILENCE_RMS_SOFT_THRESHOLD).toBe(0.015);
      expect(SILENCE_NSP_THRESHOLD).toBe(0.7);
    });
  });

  describe("Layer 1: 語速異常偵測", () => {
    it("[P0] 錄音 < 1 秒且文字 > 10 字 → 幻覺", () => {
      const result = detectHallucination({
        rawText: "謝謝收看請訂閱我的頻道感謝大家",
        recordingDurationMs: 500,
        peakEnergyLevel: 0.5,
        ...NORMAL_DEFAULTS,
      });

      expect(result.isHallucination).toBe(true);
      expect(result.reason).toBe("speed-anomaly");
      expect(result.detectedText).toBe("謝謝收看請訂閱我的頻道感謝大家");
    });

    it("[P0] 錄音恰好 1000ms 不應觸發 Layer 1", () => {
      const result = detectHallucination({
        rawText: "謝謝收看請訂閱我的頻道感謝大家",
        recordingDurationMs: 1000,
        peakEnergyLevel: 0.001,
        ...NORMAL_DEFAULTS,
      });

      // Layer 1 不觸發，但 Layer 2 無人聲偵測會攔截
      expect(result.reason).not.toBe("speed-anomaly");
    });

    it("[P0] 文字恰好 10 字不應觸發 Layer 1", () => {
      const result = detectHallucination({
        rawText: "一二三四五六七八九十",
        recordingDurationMs: 500,
        peakEnergyLevel: 0.5,
        ...NORMAL_DEFAULTS,
      });

      expect(result.isHallucination).toBe(false);
    });

    it("[P1] 帶前後空白的文字應 trim 後計算字數", () => {
      const result = detectHallucination({
        rawText: "  謝謝收看請訂閱我的頻道感謝大家  ",
        recordingDurationMs: 500,
        peakEnergyLevel: 0.5,
        ...NORMAL_DEFAULTS,
      });

      expect(result.isHallucination).toBe(true);
      expect(result.detectedText).toBe("謝謝收看請訂閱我的頻道感謝大家");
    });
  });

  describe("Layer 2: 無人聲偵測", () => {
    describe("2a: 靜音（peak energy）", () => {
      it("[P0] peakEnergyLevel 低於門檻 → 幻覺", () => {
        const result = detectHallucination({
          rawText: "謝謝收看",
          recordingDurationMs: 2000,
          peakEnergyLevel: 0.001,
          ...NORMAL_DEFAULTS,
        });

        expect(result.isHallucination).toBe(true);
        expect(result.reason).toBe("no-speech-detected");
      });

      it("[P0] peakEnergyLevel 恰好等於門檻 → 放行", () => {
        const result = detectHallucination({
          rawText: "謝謝收看",
          recordingDurationMs: 2000,
          peakEnergyLevel: SILENCE_PEAK_ENERGY_THRESHOLD,
          ...NORMAL_DEFAULTS,
        });

        expect(result.isHallucination).toBe(false);
      });

      it("[P0] peakEnergyLevel = 0.0（完全靜音）→ 攔截", () => {
        const result = detectHallucination({
          rawText: "字幕由Amara社區提供",
          recordingDurationMs: 5000,
          peakEnergyLevel: 0.0,
          ...NORMAL_DEFAULTS,
        });

        expect(result.isHallucination).toBe(true);
        expect(result.reason).toBe("no-speech-detected");
      });
    });

    describe("2b: 極低 RMS", () => {
      it("[P0] rms < 0.008 → 幻覺（即使 NSP=0）", () => {
        const result = detectHallucination({
          rawText: "MING PAO CANADA // MING PAO TORONTO",
          recordingDurationMs: 1388,
          peakEnergyLevel: 0.031,
          rmsEnergyLevel: 0.0066,
          noSpeechProbability: 0.0,
        });

        expect(result.isHallucination).toBe(true);
        expect(result.reason).toBe("no-speech-detected");
      });

      it("[P0] rms 恰好等於 hard 門檻 → 不觸發 2b（進入 2c 判斷）", () => {
        const result = detectHallucination({
          rawText: "一些文字",
          recordingDurationMs: 2000,
          peakEnergyLevel: 0.15,
          rmsEnergyLevel: SILENCE_RMS_HARD_THRESHOLD,
          noSpeechProbability: 0.3,
        });

        // rms = 0.008，不滿足 < 0.008；NSP = 0.3 不滿足 > 0.7 → 放行
        expect(result.isHallucination).toBe(false);
      });
    });

    describe("2c: 低 RMS + 高 NSP 聯合判斷", () => {
      it("[P0] rms < 0.015 且 NSP > 0.7 → 幻覺", () => {
        const result = detectHallucination({
          rawText: "MING PAO CANADA // MING PAO TORONTO",
          recordingDurationMs: 3729,
          peakEnergyLevel: 0.15,
          rmsEnergyLevel: 0.012,
          noSpeechProbability: 0.85,
        });

        expect(result.isHallucination).toBe(true);
        expect(result.reason).toBe("no-speech-detected");
      });

      it("[P0] rms < 0.015 但 NSP <= 0.7 → 放行", () => {
        const result = detectHallucination({
          rawText: "一些文字",
          recordingDurationMs: 2000,
          peakEnergyLevel: 0.15,
          rmsEnergyLevel: 0.012,
          noSpeechProbability: 0.3,
        });

        expect(result.isHallucination).toBe(false);
      });

      it("[P0] rms >= 0.015 但 NSP > 0.7 → 放行（有持續聲音）", () => {
        const result = detectHallucination({
          rawText: "一些文字",
          recordingDurationMs: 2000,
          peakEnergyLevel: 0.15,
          rmsEnergyLevel: 0.05,
          noSpeechProbability: 0.85,
        });

        expect(result.isHallucination).toBe(false);
      });

      it("[P0] rms 恰好等於 soft 門檻 → 放行", () => {
        const result = detectHallucination({
          rawText: "一些文字",
          recordingDurationMs: 2000,
          peakEnergyLevel: 0.15,
          rmsEnergyLevel: SILENCE_RMS_SOFT_THRESHOLD,
          noSpeechProbability: 0.85,
        });

        expect(result.isHallucination).toBe(false);
      });

      it("[P0] NSP 恰好等於門檻 → 放行", () => {
        const result = detectHallucination({
          rawText: "一些文字",
          recordingDurationMs: 2000,
          peakEnergyLevel: 0.15,
          rmsEnergyLevel: 0.012,
          noSpeechProbability: SILENCE_NSP_THRESHOLD,
        });

        expect(result.isHallucination).toBe(false);
      });
    });

    it("[P0] 實際案例重現：peak=0.031, rms=0.0066, NSP=0.000 → 攔截", () => {
      const result = detectHallucination({
        rawText: "MING PAO CANADA // MING PAO TORONTO",
        recordingDurationMs: 1388,
        peakEnergyLevel: 0.031,
        rmsEnergyLevel: 0.0066,
        noSpeechProbability: 0.0,
      });

      expect(result.isHallucination).toBe(true);
      expect(result.reason).toBe("no-speech-detected");
    });
  });

  describe("正常放行", () => {
    it("[P0] 有能量的正常語音 → 放行", () => {
      const result = detectHallucination({
        rawText: "這是一段正常的語音轉錄文字",
        recordingDurationMs: 3000,
        peakEnergyLevel: 0.3,
        ...NORMAL_DEFAULTS,
      });

      expect(result.isHallucination).toBe(false);
      expect(result.reason).toBeNull();
    });

    it("[P0] 有能量 + 曾被誤判的正常文字 → 放行（不再有字典比對）", () => {
      const result = detectHallucination({
        rawText: "謝謝收看",
        recordingDurationMs: 1500,
        peakEnergyLevel: 0.15,
        ...NORMAL_DEFAULTS,
      });

      expect(result.isHallucination).toBe(false);
    });
  });

  describe("Layer 優先級", () => {
    it("[P0] Layer 1 優先於 Layer 2（即使靜音，語速異常優先）", () => {
      const result = detectHallucination({
        rawText: "謝謝收看請訂閱我的頻道感謝大家",
        recordingDurationMs: 500,
        peakEnergyLevel: 0.001,
        ...NORMAL_DEFAULTS,
      });

      expect(result.reason).toBe("speed-anomaly");
    });

    it("[P0] Layer 2 peak 優先於 Layer 2 rms（都在同一個 if 中）", () => {
      const result = detectHallucination({
        rawText: "謝謝收看",
        recordingDurationMs: 2000,
        peakEnergyLevel: 0.001,
        rmsEnergyLevel: 0.001,
        noSpeechProbability: 0.9,
      });

      // 都返回 "no-speech-detected"，不需要區分子原因
      expect(result.reason).toBe("no-speech-detected");
    });
  });
});
