import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { initSentryForHud, captureError } from "./lib/sentry";
import i18n from "./i18n";
import "./style.css";

const pinia = createPinia();
const app = createApp(App);

initSentryForHud(app);

window.addEventListener("unhandledrejection", (event) => {
  captureError(event.reason, { source: "hud-unhandled-rejection" });
});

app.config.errorHandler = (err, _instance, info) => {
  console.error("[HUD] Vue error:", err);
  captureError(err, { source: "hud-vue-error", info });
};

app.use(pinia).use(i18n).mount("#app");
