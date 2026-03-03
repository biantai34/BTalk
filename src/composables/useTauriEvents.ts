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
