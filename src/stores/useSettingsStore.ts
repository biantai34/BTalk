import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { load } from "@tauri-apps/plugin-store";
import type { TriggerMode } from "../types";
import type { HotkeyConfig, TriggerKey } from "../types/settings";
import { extractErrorMessage } from "../lib/errorUtils";
import { DEFAULT_SYSTEM_PROMPT } from "../lib/enhancer";
import { emitEvent, SETTINGS_UPDATED } from "../composables/useTauriEvents";
import type { SettingsUpdatedPayload } from "../types/events";

const STORE_NAME = "settings.json";

function getDefaultTriggerKey(): TriggerKey {
  const isMac = navigator.userAgent.includes("Mac");
  return isMac ? "fn" : "rightAlt";
}

export const useSettingsStore = defineStore("settings", () => {
  const hotkeyConfig = ref<HotkeyConfig | null>(null);
  const triggerMode = computed<TriggerMode>(
    () => hotkeyConfig.value?.triggerMode ?? "hold",
  );
  const apiKey = ref<string>("");
  const hasApiKey = computed(() => apiKey.value !== "");
  const aiPrompt = ref<string>(DEFAULT_SYSTEM_PROMPT);
  const isAutoStartEnabled = ref(false);
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

      const key = savedKey ?? getDefaultTriggerKey();
      const mode = savedMode ?? "hold";

      hotkeyConfig.value = { triggerKey: key, triggerMode: mode };
      apiKey.value = savedApiKey?.trim() ?? "";

      const savedPrompt = await store.get<string>("aiPrompt");
      aiPrompt.value = savedPrompt?.trim() || DEFAULT_SYSTEM_PROMPT;

      // Sync saved (or default) config to Rust on startup
      await syncHotkeyConfigToRust(key, mode);
      isLoaded = true;
      console.log(
        `[useSettingsStore] Settings loaded: key=${key}, mode=${mode}`,
      );
    } catch (err) {
      console.error(
        "[useSettingsStore] loadSettings failed:",
        extractErrorMessage(err),
      );

      // Fallback to platform defaults
      const key = getDefaultTriggerKey();
      hotkeyConfig.value = { triggerKey: key, triggerMode: "hold" };
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
        `[useSettingsStore] Hotkey config saved: key=${key}, mode=${mode}`,
      );
    } catch (err) {
      console.error(
        "[useSettingsStore] saveHotkeyConfig failed:",
        extractErrorMessage(err),
      );
      throw err;
    }
  }

  async function saveApiKey(key: string) {
    const trimmedKey = key.trim();
    if (trimmedKey === "") {
      throw new Error("API Key 不可為空白");
    }

    try {
      const store = await load(STORE_NAME);
      await store.set("groqApiKey", trimmedKey);
      await store.save();
      apiKey.value = trimmedKey;
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
      throw new Error("Prompt 不可為空白");
    }

    try {
      const store = await load(STORE_NAME);
      await store.set("aiPrompt", trimmedPrompt);
      await store.save();
      aiPrompt.value = trimmedPrompt;
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
      aiPrompt.value = DEFAULT_SYSTEM_PROMPT;
      await store.set("aiPrompt", DEFAULT_SYSTEM_PROMPT);
      await store.save();
      console.log("[useSettingsStore] AI Prompt reset to default");
    } catch (err) {
      console.error(
        "[useSettingsStore] resetAiPrompt failed:",
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
    getApiKey,
    getAiPrompt,
    saveAiPrompt,
    resetAiPrompt,
    refreshApiKey,
    loadSettings,
    saveHotkeyConfig,
    saveApiKey,
    deleteApiKey,
    loadAutoStartStatus,
    toggleAutoStart,
    initializeAutoStart,
  };
});
