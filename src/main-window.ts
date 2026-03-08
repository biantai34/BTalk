import { createApp, nextTick } from "vue";
import { createPinia } from "pinia";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import MainApp from "./MainApp.vue";
import router from "./router";
import { initializeDatabase } from "./lib/database";
import { extractErrorMessage } from "./lib/errorUtils";
import { initSentryForDashboard, captureError } from "./lib/sentry";
import { useSettingsStore } from "./stores/useSettingsStore";
import i18n from "./i18n";
import "./style.css";

// 停用 WebView 預設右鍵選單（Back / Reload），讓 app 行為更接近原生
document.addEventListener("contextmenu", (e) => e.preventDefault());

async function bootstrap() {
  const pinia = createPinia();
  const app = createApp(MainApp);

  initSentryForDashboard(app, router);

  window.addEventListener("unhandledrejection", (event) => {
    captureError(event.reason, { source: "dashboard-unhandled-rejection" });
  });

  app.config.errorHandler = (err, _instance, info) => {
    console.error("[Dashboard] Vue error:", err);
    captureError(err, { source: "dashboard-vue-error", info });
  };

  app.use(pinia).use(i18n).use(router);

  // DB 必須在 mount 之前初始化，否則 View 的 onMounted 會因 getDatabase() 拋錯而全部失敗
  try {
    await initializeDatabase();
  } catch (err) {
    const message = extractErrorMessage(err);
    console.error("[main-window] Database init failed:", message);
    captureError(err, { source: "database-init" });
    await invoke("debug_log", {
      level: "error",
      message: `Database init failed: ${message}`,
    });
  }

  app.mount("#app");
  await router.isReady();

  const settingsStore = useSettingsStore();
  await settingsStore.loadSettings();
  await settingsStore.initializeAutoStart();

  if (!settingsStore.hasApiKey) {
    await router.push("/settings");
    await nextTick();
    const currentWindow = getCurrentWindow();
    await currentWindow.show();
    await currentWindow.setFocus();
    console.log("[main-window] API Key missing, redirected to settings");
  }

  // 更新檢查由 MainApp.vue onMounted 的 autoCheckAndDownload() 處理
  console.log("[main-window] Dashboard initialized");
}

bootstrap().catch((err) => {
  console.error("[main-window] Failed to initialize:", err);
  captureError(err, { source: "bootstrap" });
});
