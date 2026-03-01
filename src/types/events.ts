import type { HudStatus, TriggerMode } from "./index";
import type { TranscriptionRecord } from "./transcription";

export interface VoiceFlowStateChangedPayload {
  status: HudStatus;
  message: string;
}

export type TranscriptionCompletedPayload = Pick<
  TranscriptionRecord,
  | "id"
  | "rawText"
  | "processedText"
  | "recordingDurationMs"
  | "transcriptionDurationMs"
  | "enhancementDurationMs"
  | "charCount"
  | "wasEnhanced"
>;

export interface SettingsUpdatedPayload {
  key: string;
  value: unknown;
}

export interface VocabularyChangedPayload {
  action: "added" | "removed";
  term: string;
}

export interface HotkeyEventPayload {
  mode: TriggerMode;
  action: "start" | "stop";
}

export interface HotkeyErrorPayload {
  error: string;
  message: string;
}
