<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";
import type { UnlistenFn } from "@tauri-apps/api/event";
import NotchHud from "./components/NotchHud.vue";
import { getCurrentWindow, Window } from "@tauri-apps/api/window";
import { useVoiceFlowStore } from "./stores/useVoiceFlowStore";
import { useSettingsStore } from "./stores/useSettingsStore";
import { useVocabularyStore } from "./stores/useVocabularyStore";
import { initializeDatabase } from "./lib/database";
import { listenToEvent, SETTINGS_UPDATED, VOCABULARY_CHANGED } from "./composables/useTauriEvents";

const voiceFlowStore = useVoiceFlowStore();
const settingsStore = useSettingsStore();
const vocabularyStore = useVocabularyStore();
let unlistenSettingsUpdated: UnlistenFn | null = null;
let unlistenVocabularyChanged: UnlistenFn | null = null;

onMounted(async () => {
  console.log("[App] Mounted, initializing voice flow...");

  // 初始化 DB（供 vocabularyStore 使用）
  let isDatabaseReady = false;
  try {
    await initializeDatabase();
    isDatabaseReady = true;
  } catch (err) {
    console.error("[App] Database init failed:", err);
  }

  // 載入詞彙（供 transcriber + enhancer 使用），DB 初始化失敗時跳過
  if (isDatabaseReady) {
    try {
      await vocabularyStore.fetchTermList();
    } catch (err) {
      console.error("[App] Vocabulary fetch failed:", err);
    }
  }

  // 監聽設定變更（Main Window 設定異動時同步到 HUD Window）
  unlistenSettingsUpdated = await listenToEvent(SETTINGS_UPDATED, () => {
    void settingsStore.refreshCrossWindowSettings();
  });

  // 監聽詞彙變更（Main Window 新增/刪除詞彙時同步）
  unlistenVocabularyChanged = await listenToEvent(
    VOCABULARY_CHANGED,
    () => {
      void vocabularyStore.fetchTermList();
    },
  );

  const appWindow = getCurrentWindow();
  await appWindow.show();
  await voiceFlowStore.initialize();

  // 啟動時直接顯示 main-window（dashboard），然後隱藏 overlay
  try {
    const mainWindow = await Window.getByLabel("main-window");
    if (mainWindow) {
      await mainWindow.show();
      await mainWindow.setFocus();
    }
  } catch (err) {
    console.error("[App] startup: show main-window failed:", err);
  }

  await appWindow.hide();
});

async function handleRetry() {
  try {
    const mainWindow = await Window.getByLabel("main-window");
    if (!mainWindow) return;
    await mainWindow.show();
    await mainWindow.setFocus();
  } catch (err) {
    console.error("[App] handleRetry: show main-window failed:", err);
  }
}

onUnmounted(() => {
  unlistenSettingsUpdated?.();
  unlistenVocabularyChanged?.();
  voiceFlowStore.cleanup();
});
</script>

<template>
  <div class="h-screen w-screen bg-transparent">
    <NotchHud
      :status="voiceFlowStore.status"
      :message="voiceFlowStore.message"
      :analyser-handle="voiceFlowStore.analyserHandle"
      :recording-elapsed-seconds="voiceFlowStore.recordingElapsedSeconds"
      @retry="handleRetry"
    />
  </div>
</template>
