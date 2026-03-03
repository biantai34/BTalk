import type { TriggerMode } from "./index";

export type TriggerKey =
  | "fn"
  | "option"
  | "rightOption"
  | "command"
  | "rightAlt"
  | "leftAlt"
  | "control"
  | "rightControl"
  | "shift";

export interface HotkeyConfig {
  triggerKey: TriggerKey;
  triggerMode: TriggerMode;
}

export interface SettingsDto {
  hotkeyConfig: HotkeyConfig | null;
  hasApiKey: boolean;
  aiPrompt: string;
}
