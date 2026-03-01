import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { load } from "@tauri-apps/plugin-store";
import type { TriggerMode } from "../types";
import type { HotkeyConfig, TriggerKey } from "../types/settings";

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
  const hasApiKey = ref(false);
  const aiPrompt = ref("");

  async function syncHotkeyConfigToRust(key: TriggerKey, mode: TriggerMode) {
    try {
      await invoke("update_hotkey_config", {
        triggerKey: key,
        triggerMode: mode,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[useSettingsStore] Failed to sync hotkey config:", msg);
    }
  }

  async function loadSettings() {
    try {
      const store = await load(STORE_NAME);
      const savedKey = await store.get<TriggerKey>("hotkeyTriggerKey");
      const savedMode = await store.get<TriggerMode>("hotkeyTriggerMode");

      const key = savedKey ?? getDefaultTriggerKey();
      const mode = savedMode ?? "hold";

      hotkeyConfig.value = { triggerKey: key, triggerMode: mode };

      // Sync saved (or default) config to Rust on startup
      await syncHotkeyConfigToRust(key, mode);
      console.log(
        `[useSettingsStore] Settings loaded: key=${key}, mode=${mode}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[useSettingsStore] loadSettings failed:", msg);

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
      console.log(
        `[useSettingsStore] Hotkey config saved: key=${key}, mode=${mode}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[useSettingsStore] saveHotkeyConfig failed:", msg);
    }
  }

  async function saveSettings() {
    // TODO: Story 1.3 — 完整設定儲存（API Key 等）
  }

  return {
    hotkeyConfig,
    triggerMode,
    hasApiKey,
    aiPrompt,
    loadSettings,
    saveSettings,
    saveHotkeyConfig,
  };
});
