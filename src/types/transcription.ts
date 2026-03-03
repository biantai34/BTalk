import type { TriggerMode } from "./index";

export interface TranscriptionRecord {
  id: string;
  timestamp: number;
  rawText: string;
  processedText: string | null;
  recordingDurationMs: number;
  transcriptionDurationMs: number;
  enhancementDurationMs: number | null;
  charCount: number;
  triggerMode: TriggerMode;
  wasEnhanced: boolean;
  wasModified: boolean | null;
  createdAt: string;
}

export interface DashboardStats {
  totalTranscriptions: number;
  totalCharacters: number;
  totalRecordingDurationMs: number;
  averageSpeedCharsPerMin: number;
  estimatedTimeSavedMs: number;
  enhancedCount: number;
}
