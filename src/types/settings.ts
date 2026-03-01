import type { TriggerMode } from "./index";

export type TriggerKey =
  | "fn"
  | "option"
  | "command"
  | "rightAlt"
  | "leftAlt"
  | "control"
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
