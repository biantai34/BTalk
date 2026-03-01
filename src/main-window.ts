import { createApp, nextTick } from "vue";
import { createPinia } from "pinia";
import { getCurrentWindow } from "@tauri-apps/api/window";
import MainApp from "./MainApp.vue";
import router from "./router";
import { initializeDatabase } from "./lib/database";
import { useSettingsStore } from "./stores/useSettingsStore";
import "./style.css";

async function bootstrap() {
  await initializeDatabase();

  const pinia = createPinia();
  createApp(MainApp).use(pinia).use(router).mount("#app");
  await router.isReady();

  const settingsStore = useSettingsStore();
  await settingsStore.loadSettings();

  if (!settingsStore.hasApiKey) {
    await router.push("/settings");
    await nextTick();
    const currentWindow = getCurrentWindow();
    await currentWindow.show();
    await currentWindow.setFocus();
    console.log("[main-window] API Key missing, redirected to settings");
  }

  console.log("[main-window] Dashboard initialized");
}

bootstrap().catch((err) => {
  console.error("[main-window] Failed to initialize:", err);
});
