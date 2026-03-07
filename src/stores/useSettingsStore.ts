import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { load } from "@tauri-apps/plugin-store";
import type { TriggerMode } from "../types";
import {
  type HotkeyConfig,
  type TriggerKey,
  type CustomTriggerKey,
  isCustomTriggerKey,
  isPresetTriggerKey,
} from "../types/settings";
import {
  getKeyDisplayName,
  getPlatformKeycode,
  isPresetEquivalentKey,
  getDangerousKeyWarning,
} from "../lib/keycodeMap";
import {
  extractErrorMessage,
  getHotkeyRecordingTimeoutMessage,
  getHotkeyUnsupportedKeyMessage,
  getHotkeyPresetHint,
} from "../lib/errorUtils";
import { getDefaultSystemPrompt } from "../lib/enhancer";
import { getDefaultPromptForLocale } from "../i18n/prompts";
import i18n from "../i18n";
import {
  type SupportedLocale,
  FALLBACK_LOCALE,
  detectSystemLocale,
  getHtmlLangForLocale,
  getWhisperCodeForLocale,
} from "../i18n/languageConfig";
import { emitEvent, SETTINGS_UPDATED } from "../composables/useTauriEvents";
import type { SettingsUpdatedPayload } from "../types/events";
import {
  DEFAULT_LLM_MODEL_ID,
  DEFAULT_WHISPER_MODEL_ID,
  getEffectiveLlmModelId,
  getEffectiveWhisperModelId,
  type LlmModelId,
  type WhisperModelId,
} from "../lib/modelRegistry";

const STORE_NAME = "settings.json";

export const DEFAULT_ENHANCEMENT_THRESHOLD_ENABLED = false;
export const DEFAULT_ENHANCEMENT_THRESHOLD_CHAR_COUNT = 10;
export const DEFAULT_MUTE_ON_RECORDING = true;

function getDefaultTriggerKey(): TriggerKey {
  const isMac = navigator.userAgent.includes("Mac");
  return isMac ? "fn" : "rightAlt";
}

const PRESET_KEY_DISPLAY_NAMES: Record<string, string> = {
  fn: "Fn",
  option: "Option (⌥)",
  rightOption: "Right Option (⌥)",
  command: "Command (⌘)",
  rightAlt: "Right Alt",
  leftAlt: "Left Alt",
  control: "Control (⌃)",
  rightControl: "Right Control",
  shift: "Shift (⇧)",
};

export const useSettingsStore = defineStore("settings", () => {
  const hotkeyConfig = ref<HotkeyConfig | null>(null);
  const triggerMode = computed<TriggerMode>(
    () => hotkeyConfig.value?.triggerMode ?? "hold",
  );
  const apiKey = ref<string>("");
  const hasApiKey = computed(() => apiKey.value !== "");
  const aiPrompt = ref<string>(getDefaultSystemPrompt());
  const isAutoStartEnabled = ref(false);
  const isEnhancementThresholdEnabled = ref(
    DEFAULT_ENHANCEMENT_THRESHOLD_ENABLED,
  );
  const enhancementThresholdCharCount = ref(
    DEFAULT_ENHANCEMENT_THRESHOLD_CHAR_COUNT,
  );
  const selectedLlmModelId = ref<LlmModelId>(DEFAULT_LLM_MODEL_ID);
  const selectedWhisperModelId = ref<WhisperModelId>(DEFAULT_WHISPER_MODEL_ID);
  const customTriggerKey = ref<CustomTriggerKey | null>(null);
  const isMuteOnRecordingEnabled = ref<boolean>(DEFAULT_MUTE_ON_RECORDING);
  const customTriggerKeyDomCode = ref<string>("");
  const selectedLocale = ref<SupportedLocale>(FALLBACK_LOCALE);
  let isLoaded = false;

  function getApiKey(): string {
    return apiKey.value;
  }

  async function syncHotkeyConfigToRust(key: TriggerKey, mode: TriggerMode) {
    try {
      await invoke("update_hotkey_config", {
        triggerKey: key,
        triggerMode: mode,
      });
    } catch (err) {
      console.error(
        "[useSettingsStore] Failed to sync hotkey config:",
        extractErrorMessage(err),
      );
    }
  }

  async function loadSettings() {
    if (isLoaded) return;

    try {
      const store = await load(STORE_NAME);
      const savedKey = await store.get<TriggerKey>("hotkeyTriggerKey");
      const savedMode = await store.get<TriggerMode>("hotkeyTriggerMode");
      const savedApiKey = await store.get<string>("groqApiKey");

      // Backward-compatible key parsing: string → PresetTriggerKey, object → CustomTriggerKey
      const key = savedKey ?? getDefaultTriggerKey();
      const mode = savedMode ?? "hold";

      hotkeyConfig.value = { triggerKey: key, triggerMode: mode };
      apiKey.value = savedApiKey?.trim() ?? "";

      // Load independently persisted custom key
      const savedCustomKey =
        await store.get<CustomTriggerKey>("customTriggerKey");
      const savedCustomDomCode = await store.get<string>(
        "customTriggerKeyDomCode",
      );
      if (savedCustomKey && isCustomTriggerKey(savedCustomKey)) {
        customTriggerKey.value = savedCustomKey;
        customTriggerKeyDomCode.value = savedCustomDomCode ?? "";
      }

      // Load locale (first launch: detect system language, upgrade: fallback to zh-TW)
      const savedLocale = await store.get<SupportedLocale>("selectedLocale");
      if (savedLocale) {
        selectedLocale.value = savedLocale;
      } else {
        const detected = detectSystemLocale();
        selectedLocale.value = detected;
        await store.set("selectedLocale", detected);
        await store.save();
      }
      i18n.global.locale.value = selectedLocale.value;
      document.documentElement.lang = getHtmlLangForLocale(
        selectedLocale.value,
      );

      const savedPrompt = await store.get<string>("aiPrompt");
      aiPrompt.value =
        savedPrompt?.trim() || getDefaultPromptForLocale(selectedLocale.value);

      const savedThresholdEnabled = await store.get<boolean>(
        "enhancementThresholdEnabled",
      );
      isEnhancementThresholdEnabled.value =
        savedThresholdEnabled ?? DEFAULT_ENHANCEMENT_THRESHOLD_ENABLED;

      const savedThresholdCharCount = await store.get<number>(
        "enhancementThresholdCharCount",
      );
      enhancementThresholdCharCount.value =
        savedThresholdCharCount ?? DEFAULT_ENHANCEMENT_THRESHOLD_CHAR_COUNT;

      const savedLlmModelId = await store.get<string>("llmModelId");
      selectedLlmModelId.value = getEffectiveLlmModelId(
        savedLlmModelId ?? null,
      );

      const savedWhisperModelId = await store.get<string>("whisperModelId");
      selectedWhisperModelId.value = getEffectiveWhisperModelId(
        savedWhisperModelId ?? null,
      );

      const savedMuteOnRecording = await store.get<boolean>("muteOnRecording");
      isMuteOnRecordingEnabled.value =
        savedMuteOnRecording ?? DEFAULT_MUTE_ON_RECORDING;

      // Sync saved (or default) config to Rust on startup
      await syncHotkeyConfigToRust(key, mode);
      isLoaded = true;
      console.log(
        `[useSettingsStore] Settings loaded: key=${JSON.stringify(key)}, mode=${mode}`,
      );
    } catch (err) {
      console.error(
        "[useSettingsStore] loadSettings failed:",
        extractErrorMessage(err),
      );

      // Fallback to platform defaults
      const key = getDefaultTriggerKey();
      hotkeyConfig.value = { triggerKey: key, triggerMode: "hold" };
      isEnhancementThresholdEnabled.value =
        DEFAULT_ENHANCEMENT_THRESHOLD_ENABLED;
      enhancementThresholdCharCount.value =
        DEFAULT_ENHANCEMENT_THRESHOLD_CHAR_COUNT;
      isMuteOnRecordingEnabled.value = DEFAULT_MUTE_ON_RECORDING;
    }
  }

  async function saveHotkeyConfig(key: TriggerKey, mode: TriggerMode) {
    try {
      const store = await load(STORE_NAME);
      await store.set("hotkeyTriggerKey", key);
      await store.set("hotkeyTriggerMode", mode);
      await store.save();

      hotkeyConfig.value = { triggerKey: key, triggerMode: mode };

      // Sync to Rust immediately
      await syncHotkeyConfigToRust(key, mode);

      // Broadcast settings change to all windows
      const payload: SettingsUpdatedPayload = {
        key: "hotkey",
        value: { triggerKey: key, triggerMode: mode },
      };
      await emitEvent(SETTINGS_UPDATED, payload);

      console.log(
        `[useSettingsStore] Hotkey config saved: key=${JSON.stringify(key)}, mode=${mode}`,
      );
    } catch (err) {
      console.error(
        "[useSettingsStore] saveHotkeyConfig failed:",
        extractErrorMessage(err),
      );
      throw err;
    }
  }

  async function saveCustomTriggerKey(
    keycode: number,
    domCode: string,
    mode: TriggerMode,
  ) {
    const customKey: CustomTriggerKey = { custom: { keycode } };
    try {
      // Persist custom key independently (survives mode switching)
      const store = await load(STORE_NAME);
      await store.set("customTriggerKey", customKey);
      await store.set("customTriggerKeyDomCode", domCode);
      await store.save();

      customTriggerKey.value = customKey;
      customTriggerKeyDomCode.value = domCode;

      // Reuse shared logic for active key + Rust sync + event broadcast
      await saveHotkeyConfig(customKey, mode);

      console.log(
        `[useSettingsStore] Custom trigger key saved: keycode=${keycode}, domCode=${domCode}, mode=${mode}`,
      );
    } catch (err) {
      console.error(
        "[useSettingsStore] saveCustomTriggerKey failed:",
        extractErrorMessage(err),
      );
      throw err;
    }
  }

  async function switchToPresetMode(presetKey: TriggerKey, mode: TriggerMode) {
    // Only update active key; keep customTriggerKey intact
    await saveHotkeyConfig(presetKey, mode);
  }

  async function switchToCustomMode(mode: TriggerMode) {
    if (!customTriggerKey.value) return;
    // Restore custom key as active key
    await saveHotkeyConfig(customTriggerKey.value, mode);
  }

  function getTriggerKeyDisplayName(key: TriggerKey): string {
    if (isPresetTriggerKey(key)) {
      return PRESET_KEY_DISPLAY_NAMES[key] ?? key;
    }
    // For custom keys, use saved DOM code to look up display name
    if (customTriggerKeyDomCode.value) {
      return getKeyDisplayName(customTriggerKeyDomCode.value);
    }
    return i18n.global.t("settings.hotkey.customKeyDisplay", {
      keycode: key.custom.keycode,
    });
  }

  async function saveApiKey(key: string) {
    const trimmedKey = key.trim();
    if (trimmedKey === "") {
      throw new Error(i18n.global.t("errors.apiKeyEmpty"));
    }

    try {
      const store = await load(STORE_NAME);
      await store.set("groqApiKey", trimmedKey);
      await store.save();
      apiKey.value = trimmedKey;

      const payload: SettingsUpdatedPayload = {
        key: "apiKey",
        value: trimmedKey,
      };
      await emitEvent(SETTINGS_UPDATED, payload);

      console.log("[useSettingsStore] API Key saved");
    } catch (err) {
      console.error(
        "[useSettingsStore] saveApiKey failed:",
        extractErrorMessage(err),
      );
      throw err;
    }
  }

  async function refreshApiKey() {
    try {
      const store = await load(STORE_NAME);
      const savedApiKey = await store.get<string>("groqApiKey");
      apiKey.value = savedApiKey?.trim() ?? "";
    } catch (err) {
      console.error(
        "[useSettingsStore] refreshApiKey failed:",
        extractErrorMessage(err),
      );
    }
  }

  async function deleteApiKey() {
    try {
      const store = await load(STORE_NAME);
      await store.delete("groqApiKey");
      await store.save();
      apiKey.value = "";

      const payload: SettingsUpdatedPayload = { key: "apiKey", value: "" };
      await emitEvent(SETTINGS_UPDATED, payload);

      console.log("[useSettingsStore] API Key deleted");
    } catch (err) {
      console.error(
        "[useSettingsStore] deleteApiKey failed:",
        extractErrorMessage(err),
      );
      throw err;
    }
  }

  function getAiPrompt(): string {
    return aiPrompt.value;
  }

  async function saveAiPrompt(prompt: string) {
    const trimmedPrompt = prompt.trim();
    if (trimmedPrompt === "") {
      throw new Error(i18n.global.t("errors.promptEmpty"));
    }

    try {
      const store = await load(STORE_NAME);
      await store.set("aiPrompt", trimmedPrompt);
      await store.save();
      aiPrompt.value = trimmedPrompt;

      const payload: SettingsUpdatedPayload = {
        key: "aiPrompt",
        value: trimmedPrompt,
      };
      await emitEvent(SETTINGS_UPDATED, payload);

      console.log("[useSettingsStore] AI Prompt saved");
    } catch (err) {
      console.error(
        "[useSettingsStore] saveAiPrompt failed:",
        extractErrorMessage(err),
      );
      throw err;
    }
  }

  async function resetAiPrompt() {
    try {
      const store = await load(STORE_NAME);
      const defaultPrompt = getDefaultPromptForLocale(selectedLocale.value);
      aiPrompt.value = defaultPrompt;
      await store.set("aiPrompt", defaultPrompt);
      await store.save();
      const payload: SettingsUpdatedPayload = {
        key: "aiPrompt",
        value: defaultPrompt,
      };
      await emitEvent(SETTINGS_UPDATED, payload);

      console.log("[useSettingsStore] AI Prompt reset to default");
    } catch (err) {
      console.error(
        "[useSettingsStore] resetAiPrompt failed:",
        extractErrorMessage(err),
      );
      throw err;
    }
  }

  async function saveEnhancementThreshold(enabled: boolean, charCount: number) {
    const validatedCharCount =
      !Number.isInteger(charCount) || charCount < 1
        ? DEFAULT_ENHANCEMENT_THRESHOLD_CHAR_COUNT
        : charCount;

    try {
      const store = await load(STORE_NAME);
      await store.set("enhancementThresholdEnabled", enabled);
      await store.set("enhancementThresholdCharCount", validatedCharCount);
      await store.save();

      isEnhancementThresholdEnabled.value = enabled;
      enhancementThresholdCharCount.value = validatedCharCount;

      // Broadcast settings change to all windows
      const payload: SettingsUpdatedPayload = {
        key: "enhancementThreshold",
        value: { enabled, charCount: validatedCharCount },
      };
      await emitEvent(SETTINGS_UPDATED, payload);

      console.log(
        `[useSettingsStore] Enhancement threshold saved: enabled=${enabled}, charCount=${validatedCharCount}`,
      );
    } catch (err) {
      console.error(
        "[useSettingsStore] saveEnhancementThreshold failed:",
        extractErrorMessage(err),
      );
      throw err;
    }
  }

  async function saveLlmModel(id: LlmModelId) {
    try {
      const store = await load(STORE_NAME);
      await store.set("llmModelId", id);
      await store.save();
      selectedLlmModelId.value = id;

      const payload: SettingsUpdatedPayload = {
        key: "llmModel",
        value: id,
      };
      await emitEvent(SETTINGS_UPDATED, payload);
      console.log(`[useSettingsStore] LLM model saved: ${id}`);
    } catch (err) {
      console.error(
        "[useSettingsStore] saveLlmModel failed:",
        extractErrorMessage(err),
      );
      throw err;
    }
  }

  async function saveWhisperModel(id: WhisperModelId) {
    try {
      const store = await load(STORE_NAME);
      await store.set("whisperModelId", id);
      await store.save();
      selectedWhisperModelId.value = id;

      const payload: SettingsUpdatedPayload = {
        key: "whisperModel",
        value: id,
      };
      await emitEvent(SETTINGS_UPDATED, payload);
      console.log(`[useSettingsStore] Whisper model saved: ${id}`);
    } catch (err) {
      console.error(
        "[useSettingsStore] saveWhisperModel failed:",
        extractErrorMessage(err),
      );
      throw err;
    }
  }

  async function loadAutoStartStatus() {
    try {
      const { isEnabled } = await import("@tauri-apps/plugin-autostart");
      isAutoStartEnabled.value = await isEnabled();
    } catch (err) {
      console.error(
        "[useSettingsStore] loadAutoStartStatus failed:",
        extractErrorMessage(err),
      );
    }
  }

  async function toggleAutoStart() {
    try {
      if (isAutoStartEnabled.value) {
        const { disable } = await import("@tauri-apps/plugin-autostart");
        await disable();
        isAutoStartEnabled.value = false;
      } else {
        const { enable } = await import("@tauri-apps/plugin-autostart");
        await enable();
        isAutoStartEnabled.value = true;
      }
    } catch (err) {
      console.error(
        "[useSettingsStore] toggleAutoStart failed:",
        extractErrorMessage(err),
      );
      throw err;
    }
  }

  async function saveLocale(locale: SupportedLocale) {
    try {
      const store = await load(STORE_NAME);
      const oldLocale = selectedLocale.value;

      await store.set("selectedLocale", locale);
      selectedLocale.value = locale;
      i18n.global.locale.value = locale;
      document.documentElement.lang = getHtmlLangForLocale(locale);

      // Prompt auto-switch: if current prompt equals old locale's default, update to new
      const oldDefault = getDefaultPromptForLocale(oldLocale);
      if (aiPrompt.value === oldDefault) {
        const newDefault = getDefaultPromptForLocale(locale);
        aiPrompt.value = newDefault;
        await store.set("aiPrompt", newDefault);
      }

      await store.save();

      const payload: SettingsUpdatedPayload = {
        key: "locale",
        value: locale,
      };
      await emitEvent(SETTINGS_UPDATED, payload);
      console.log(`[useSettingsStore] Locale saved: ${locale}`);
    } catch (err) {
      console.error(
        "[useSettingsStore] saveLocale failed:",
        extractErrorMessage(err),
      );
      throw err;
    }
  }

  function getWhisperLanguageCode(): string {
    return getWhisperCodeForLocale(selectedLocale.value);
  }

  async function saveMuteOnRecording(enabled: boolean) {
    try {
      const store = await load(STORE_NAME);
      await store.set("muteOnRecording", enabled);
      await store.save();
      isMuteOnRecordingEnabled.value = enabled;

      const payload: SettingsUpdatedPayload = {
        key: "muteOnRecording",
        value: enabled,
      };
      await emitEvent(SETTINGS_UPDATED, payload);
      console.log(`[useSettingsStore] muteOnRecording saved: ${enabled}`);
    } catch (err) {
      console.error(
        "[useSettingsStore] saveMuteOnRecording failed:",
        extractErrorMessage(err),
      );
      throw err;
    }
  }

  async function refreshCrossWindowSettings() {
    try {
      const store = await load(STORE_NAME);
      const savedKey = await store.get<TriggerKey>("hotkeyTriggerKey");
      const savedMode = await store.get<TriggerMode>("hotkeyTriggerMode");
      const savedCustomKey =
        await store.get<CustomTriggerKey>("customTriggerKey");
      const savedCustomDomCode = await store.get<string>(
        "customTriggerKeyDomCode",
      );
      const savedApiKey = await store.get<string>("groqApiKey");
      const savedPrompt = await store.get<string>("aiPrompt");
      const savedThresholdEnabled = await store.get<boolean>(
        "enhancementThresholdEnabled",
      );
      const savedThresholdCharCount = await store.get<number>(
        "enhancementThresholdCharCount",
      );
      const savedLlmModelId = await store.get<string>("llmModelId");
      const savedWhisperModelId = await store.get<string>("whisperModelId");
      const savedMuteOnRecording = await store.get<boolean>("muteOnRecording");

      hotkeyConfig.value = {
        triggerKey: savedKey ?? getDefaultTriggerKey(),
        triggerMode: savedMode ?? "hold",
      };
      customTriggerKey.value =
        savedCustomKey && isCustomTriggerKey(savedCustomKey)
          ? savedCustomKey
          : null;
      customTriggerKeyDomCode.value =
        savedCustomKey && isCustomTriggerKey(savedCustomKey)
          ? (savedCustomDomCode ?? "")
          : "";
      // Locale must be synced first — aiPrompt fallback depends on it
      const savedLocale = await store.get<SupportedLocale>("selectedLocale");
      selectedLocale.value = savedLocale ?? FALLBACK_LOCALE;
      i18n.global.locale.value = selectedLocale.value;
      document.documentElement.lang = getHtmlLangForLocale(
        selectedLocale.value,
      );

      apiKey.value = savedApiKey?.trim() ?? "";
      aiPrompt.value =
        savedPrompt?.trim() || getDefaultPromptForLocale(selectedLocale.value);
      isEnhancementThresholdEnabled.value =
        savedThresholdEnabled ?? DEFAULT_ENHANCEMENT_THRESHOLD_ENABLED;
      enhancementThresholdCharCount.value =
        savedThresholdCharCount ?? DEFAULT_ENHANCEMENT_THRESHOLD_CHAR_COUNT;
      selectedLlmModelId.value = getEffectiveLlmModelId(
        savedLlmModelId ?? null,
      );
      selectedWhisperModelId.value = getEffectiveWhisperModelId(
        savedWhisperModelId ?? null,
      );
      isMuteOnRecordingEnabled.value =
        savedMuteOnRecording ?? DEFAULT_MUTE_ON_RECORDING;
    } catch (err) {
      console.error(
        "[useSettingsStore] refreshCrossWindowSettings failed:",
        extractErrorMessage(err),
      );
    }
  }

  async function initializeAutoStart() {
    try {
      const store = await load(STORE_NAME);
      const hasInitAutoStart = await store.get<boolean>("hasInitAutoStart");

      if (!hasInitAutoStart) {
        const { enable } = await import("@tauri-apps/plugin-autostart");
        await enable();
        await store.set("hasInitAutoStart", true);
        await store.save();
        isAutoStartEnabled.value = true;
        console.log("[useSettingsStore] Auto-start enabled on first launch");
      } else {
        await loadAutoStartStatus();
      }
    } catch (err) {
      console.error(
        "[useSettingsStore] initializeAutoStart failed:",
        extractErrorMessage(err),
      );
    }
  }

  return {
    hotkeyConfig,
    triggerMode,
    hasApiKey,
    aiPrompt,
    isAutoStartEnabled,
    isEnhancementThresholdEnabled,
    enhancementThresholdCharCount,
    selectedLlmModelId,
    selectedWhisperModelId,
    getApiKey,
    getAiPrompt,
    saveAiPrompt,
    resetAiPrompt,
    refreshApiKey,
    loadSettings,
    saveHotkeyConfig,
    saveCustomTriggerKey,
    switchToPresetMode,
    switchToCustomMode,
    getTriggerKeyDisplayName,
    customTriggerKey,
    customTriggerKeyDomCode,
    // Hotkey recording helpers (proxied from lib/ for views)
    getPlatformKeycode,
    getKeyDisplayName,
    isPresetEquivalentKey,
    getDangerousKeyWarning,
    getHotkeyRecordingTimeoutMessage,
    getHotkeyUnsupportedKeyMessage,
    getHotkeyPresetHint,
    saveApiKey,
    deleteApiKey,
    saveEnhancementThreshold,
    saveLlmModel,
    saveWhisperModel,
    isMuteOnRecordingEnabled,
    saveMuteOnRecording,
    selectedLocale,
    saveLocale,
    getWhisperLanguageCode,
    refreshCrossWindowSettings,
    loadAutoStartStatus,
    toggleAutoStart,
    initializeAutoStart,
  };
});
