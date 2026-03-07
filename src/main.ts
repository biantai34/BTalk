import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { initSentryForHud } from "./lib/sentry";
import i18n from "./i18n";
import "./style.css";

const pinia = createPinia();
const app = createApp(App);

initSentryForHud(app);

app.use(pinia).use(i18n).mount("#app");
