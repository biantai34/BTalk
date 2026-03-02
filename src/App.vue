<script setup lang="ts">
import { onMounted, onUnmounted } from "vue";
import NotchHud from "./components/NotchHud.vue";
import { getCurrentWindow, Window } from "@tauri-apps/api/window";
import { useVoiceFlowStore } from "./stores/useVoiceFlowStore";

const voiceFlowStore = useVoiceFlowStore();

onMounted(async () => {
  console.log("[App] Mounted, initializing voice flow...");

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
  voiceFlowStore.cleanup();
});
</script>

<template>
  <div class="h-screen w-screen bg-transparent">
    <NotchHud
      :status="voiceFlowStore.status"
      :analyser-handle="voiceFlowStore.analyserHandle"
      :recording-elapsed-seconds="voiceFlowStore.recordingElapsedSeconds"
      @retry="handleRetry"
    />
  </div>
</template>
