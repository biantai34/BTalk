export {
  emit as emitEvent,
  emitTo as emitToWindow,
} from "@tauri-apps/api/event";
export { listen as listenToEvent } from "@tauri-apps/api/event";

export const VOICE_FLOW_STATE_CHANGED = "voice-flow:state-changed" as const;
export const TRANSCRIPTION_COMPLETED = "transcription:completed" as const;
export const SETTINGS_UPDATED = "settings:updated" as const;
export const VOCABULARY_CHANGED = "vocabulary:changed" as const;

export const HOTKEY_PRESSED = "hotkey:pressed" as const;
export const HOTKEY_RELEASED = "hotkey:released" as const;
export const HOTKEY_TOGGLED = "hotkey:toggled" as const;
export const HOTKEY_ERROR = "hotkey:error" as const;

export const QUALITY_MONITOR_RESULT = "quality-monitor:result" as const;

export const AUDIO_WAVEFORM = "audio:waveform" as const;
export const AUDIO_PREVIEW_LEVEL = "audio:preview-level" as const;

export const CORRECTION_MONITOR_RESULT = "correction-monitor:result" as const;
export const VOCABULARY_LEARNED = "vocabulary:learned" as const;
export const ESCAPE_PRESSED = "escape:pressed" as const;
export const HOTKEY_MODE_TOGGLE = "hotkey:mode-toggle" as const;
export const HOTKEY_RECORDING_CAPTURED = "hotkey:recording-captured" as const;
export const HOTKEY_RECORDING_REJECTED = "hotkey:recording-rejected" as const;
