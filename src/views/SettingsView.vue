<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useSettingsStore } from "../stores/useSettingsStore";
import { extractErrorMessage } from "../lib/errorUtils";
import { useFeedbackMessage } from "../composables/useFeedbackMessage";
import type { TriggerKey } from "../types/settings";
import type { TriggerMode } from "../types";

const settingsStore = useSettingsStore();

// ── 快捷鍵設定 ──────────────────────────────────────────────
const isMac = navigator.userAgent.includes("Mac");

const MAC_TRIGGER_KEY_OPTIONS: { value: TriggerKey; label: string }[] = [
  { value: "fn", label: "Fn" },
  { value: "option", label: "左 Option (\u2325)" },
  { value: "rightOption", label: "右 Option (\u2325)" },
  { value: "control", label: "左 Control (\u2303)" },
  { value: "rightControl", label: "右 Control (\u2303)" },
  { value: "command", label: "Command (\u2318)" },
  { value: "shift", label: "Shift (\u21E7)" },
];

const WINDOWS_TRIGGER_KEY_OPTIONS: { value: TriggerKey; label: string }[] = [
  { value: "rightAlt", label: "\u53F3 Alt" },
  { value: "leftAlt", label: "\u5DE6 Alt" },
  { value: "control", label: "Control" },
  { value: "shift", label: "Shift" },
];

const triggerKeyOptions = isMac
  ? MAC_TRIGGER_KEY_OPTIONS
  : WINDOWS_TRIGGER_KEY_OPTIONS;

const hotkeyFeedback = useFeedbackMessage();

async function handleTriggerKeyChange(newKey: TriggerKey) {
  const currentMode = settingsStore.triggerMode;
  try {
    await settingsStore.saveHotkeyConfig(newKey, currentMode);
    hotkeyFeedback.show("success", "觸發鍵已更新");
  } catch (err) {
    hotkeyFeedback.show("error", extractErrorMessage(err));
  }
}

async function handleTriggerModeChange(newMode: TriggerMode) {
  const currentKey =
    settingsStore.hotkeyConfig?.triggerKey ?? (isMac ? "fn" : "rightAlt");
  try {
    await settingsStore.saveHotkeyConfig(currentKey, newMode);
    hotkeyFeedback.show("success", "觸發模式已更新");
  } catch (err) {
    hotkeyFeedback.show("error", extractErrorMessage(err));
  }
}

// ── API Key ─────────────────────────────────────────────────
const apiKeyInput = ref("");
const isApiKeyVisible = ref(false);
const isSubmittingApiKey = ref(false);
const apiKeyFeedback = useFeedbackMessage();

const isConfirmingDeleteApiKey = ref(false);
let deleteConfirmTimeoutId: ReturnType<typeof setTimeout> | undefined;

const promptInput = ref("");
const isSubmittingPrompt = ref(false);
const promptFeedback = useFeedbackMessage();

const isConfirmingResetPrompt = ref(false);
let resetPromptConfirmTimeoutId: ReturnType<typeof setTimeout> | undefined;

const apiKeyStatusLabel = computed(() =>
  settingsStore.hasApiKey ? "已設定" : "未設定",
);
const apiKeyStatusClass = computed(() =>
  settingsStore.hasApiKey
    ? "bg-green-500/20 text-green-400"
    : "bg-red-500/20 text-red-400",
);
const shouldShowOnboardingHint = computed(() => !settingsStore.hasApiKey);

function toggleApiKeyVisibility() {
  isApiKeyVisible.value = !isApiKeyVisible.value;
}

async function handleSaveApiKey() {
  try {
    isSubmittingApiKey.value = true;
    await settingsStore.saveApiKey(apiKeyInput.value);
    isApiKeyVisible.value = false;
    apiKeyFeedback.show("success", "API Key 已儲存");
  } catch (err) {
    apiKeyFeedback.show("error", extractErrorMessage(err));
  } finally {
    isSubmittingApiKey.value = false;
  }
}

function requestDeleteApiKey() {
  if (!isConfirmingDeleteApiKey.value) {
    isConfirmingDeleteApiKey.value = true;
    deleteConfirmTimeoutId = setTimeout(() => {
      isConfirmingDeleteApiKey.value = false;
    }, 3000);
    return;
  }
  clearTimeout(deleteConfirmTimeoutId);
  isConfirmingDeleteApiKey.value = false;
  handleDeleteApiKey();
}

async function handleDeleteApiKey() {
  try {
    isSubmittingApiKey.value = true;
    await settingsStore.deleteApiKey();
    apiKeyInput.value = "";
    isApiKeyVisible.value = false;
    apiKeyFeedback.show("success", "API Key 已刪除");
  } catch (err) {
    apiKeyFeedback.show("error", extractErrorMessage(err));
  } finally {
    isSubmittingApiKey.value = false;
  }
}

async function handleSavePrompt() {
  try {
    isSubmittingPrompt.value = true;
    await settingsStore.saveAiPrompt(promptInput.value);
    promptFeedback.show("success", "Prompt 已儲存");
  } catch (err) {
    promptFeedback.show("error", extractErrorMessage(err));
  } finally {
    isSubmittingPrompt.value = false;
  }
}

function requestResetPrompt() {
  if (!isConfirmingResetPrompt.value) {
    isConfirmingResetPrompt.value = true;
    resetPromptConfirmTimeoutId = setTimeout(() => {
      isConfirmingResetPrompt.value = false;
    }, 3000);
    return;
  }
  clearTimeout(resetPromptConfirmTimeoutId);
  isConfirmingResetPrompt.value = false;
  handleResetPrompt();
}

async function handleResetPrompt() {
  try {
    isSubmittingPrompt.value = true;
    await settingsStore.resetAiPrompt();
    promptInput.value = settingsStore.getAiPrompt();
    promptFeedback.show("success", "已重置為預設");
  } catch (err) {
    promptFeedback.show("error", extractErrorMessage(err));
  } finally {
    isSubmittingPrompt.value = false;
  }
}

// ── 應用程式 ────────────────────────────────────────────────
const autoStartFeedback = useFeedbackMessage();
const isTogglingAutoStart = ref(false);

async function handleToggleAutoStart() {
  try {
    isTogglingAutoStart.value = true;
    await settingsStore.toggleAutoStart();
    autoStartFeedback.show(
      "success",
      settingsStore.isAutoStartEnabled ? "已啟用開機自啟動" : "已關閉開機自啟動",
    );
  } catch (err) {
    autoStartFeedback.show("error", extractErrorMessage(err));
  } finally {
    isTogglingAutoStart.value = false;
  }
}

onMounted(async () => {
  promptInput.value = settingsStore.getAiPrompt();
  if (settingsStore.hasApiKey) {
    apiKeyInput.value = settingsStore.getApiKey();
  }
  await settingsStore.loadAutoStartStatus();
});

onBeforeUnmount(() => {
  hotkeyFeedback.clearTimer();
  apiKeyFeedback.clearTimer();
  promptFeedback.clearTimer();
  autoStartFeedback.clearTimer();
  clearTimeout(deleteConfirmTimeoutId);
  clearTimeout(resetPromptConfirmTimeoutId);
});
</script>

<template>
  <div class="p-6 text-white">
    <h1 class="text-2xl font-bold text-white">設定</h1>
    <p class="mt-2 text-zinc-400">快捷鍵、API Key 與應用程式偏好</p>

    <!-- 快捷鍵設定 -->
    <section class="mt-6 rounded-xl border border-zinc-700 bg-zinc-900 p-5">
      <h2 class="text-lg font-semibold text-white">快捷鍵設定</h2>

      <div class="mt-4 space-y-4">
        <!-- 觸發鍵 -->
        <div>
          <label for="trigger-key-select" class="block text-sm text-zinc-300">
            觸發鍵
          </label>
          <select
            id="trigger-key-select"
            :value="settingsStore.hotkeyConfig?.triggerKey"
            class="mt-1 w-full rounded-lg border border-zinc-600 bg-zinc-800 px-4 py-2 text-white outline-none transition focus:border-blue-500 lg:w-auto"
            @change="handleTriggerKeyChange(($event.target as HTMLSelectElement).value as TriggerKey)"
          >
            <option
              v-for="opt in triggerKeyOptions"
              :key="opt.value"
              :value="opt.value"
            >
              {{ opt.label }}
            </option>
          </select>
        </div>

        <!-- 觸發模式 -->
        <div>
          <p class="text-sm text-zinc-300">觸發模式</p>
          <div class="mt-1 flex gap-2">
            <button
              type="button"
              class="rounded-lg px-4 py-2 text-sm font-medium transition"
              :class="
                settingsStore.triggerMode === 'hold'
                  ? 'bg-blue-600 text-white'
                  : 'border border-zinc-600 text-zinc-300 hover:bg-zinc-800'
              "
              @click="handleTriggerModeChange('hold')"
            >
              Hold
            </button>
            <button
              type="button"
              class="rounded-lg px-4 py-2 text-sm font-medium transition"
              :class="
                settingsStore.triggerMode === 'toggle'
                  ? 'bg-blue-600 text-white'
                  : 'border border-zinc-600 text-zinc-300 hover:bg-zinc-800'
              "
              @click="handleTriggerModeChange('toggle')"
            >
              Toggle
            </button>
          </div>
          <p class="mt-2 text-sm text-zinc-400">
            {{
              settingsStore.triggerMode === "hold"
                ? "按住錄音，放開停止"
                : "按一下開始，再按停止"
            }}
          </p>
        </div>
      </div>

      <transition name="feedback-fade">
        <p
          v-if="hotkeyFeedback.message.value !== ''"
          class="mt-3 text-sm"
          :class="
            hotkeyFeedback.type.value === 'success'
              ? 'text-green-400'
              : 'text-red-400'
          "
        >
          {{ hotkeyFeedback.message.value }}
        </p>
      </transition>
    </section>

    <!-- Groq API Key -->
    <section class="mt-6 rounded-xl border border-zinc-700 bg-zinc-900 p-5">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h2 class="text-lg font-semibold text-white">Groq API Key</h2>
        <span
          class="rounded-full px-2 py-0.5 text-xs font-medium"
          :class="apiKeyStatusClass"
        >
          {{ apiKeyStatusLabel }}
        </span>
      </div>

      <p class="mt-2 text-sm text-zinc-400">
        請在
        <a
          href="https://console.groq.com/keys"
          target="_blank"
          rel="noreferrer"
          class="text-blue-400 transition-colors hover:text-blue-300"
        >
          Groq Console
        </a>
        產生 API Key 後貼上。
      </p>

      <p
        v-if="shouldShowOnboardingHint"
        class="mt-3 rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-sm text-blue-200"
      >
        歡迎使用 SayIt！請先設定 Groq API Key 以啟用語音輸入功能。
      </p>

      <div class="mt-4 flex flex-col gap-3 lg:flex-row">
        <div class="flex-1">
          <label for="groq-api-key-input" class="mb-2 block text-sm text-zinc-300">
            API Key
          </label>
          <div class="flex items-center gap-2">
            <input
              id="groq-api-key-input"
              v-model="apiKeyInput"
              :type="isApiKeyVisible ? 'text' : 'password'"
              placeholder="gsk_..."
              class="w-full rounded-lg border border-zinc-600 bg-zinc-800 px-4 py-2 text-white outline-none transition focus:border-blue-500"
              autocomplete="off"
            />
            <button
              type="button"
              class="rounded-lg border border-zinc-600 px-3 py-2 text-sm text-zinc-300 transition hover:bg-zinc-800 hover:text-white"
              @click="toggleApiKeyVisibility"
            >
              {{ isApiKeyVisible ? "隱藏" : "顯示" }}
            </button>
          </div>
        </div>

        <div class="flex items-end">
          <button
            type="button"
            class="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50 lg:w-auto"
            :disabled="isSubmittingApiKey"
            @click="handleSaveApiKey"
          >
            儲存
          </button>
        </div>
      </div>

      <div class="mt-4 flex items-center justify-between">
        <transition name="feedback-fade">
          <p
            v-if="apiKeyFeedback.message.value !== ''"
            class="text-sm"
            :class="
              apiKeyFeedback.type.value === 'success' ? 'text-green-400' : 'text-red-400'
            "
          >
            {{ apiKeyFeedback.message.value }}
          </p>
        </transition>

        <button
          v-if="settingsStore.hasApiKey"
          type="button"
          class="rounded-lg px-4 py-2 text-sm transition disabled:cursor-not-allowed disabled:opacity-50"
          :class="
            isConfirmingDeleteApiKey
              ? 'bg-red-600 text-white hover:bg-red-500'
              : 'bg-red-600/20 text-red-400 hover:bg-red-600/30'
          "
          :disabled="isSubmittingApiKey"
          @click="requestDeleteApiKey"
        >
          {{ isConfirmingDeleteApiKey ? '確認刪除？' : '刪除 API Key' }}
        </button>
      </div>
    </section>

    <section class="mt-6 rounded-xl border border-zinc-700 bg-zinc-900 p-5">
      <h2 class="text-lg font-semibold text-white">AI 整理 Prompt</h2>
      <p class="mt-2 text-sm text-zinc-400">
        自訂 AI 整理文字時使用的系統提示詞。修改後點擊儲存。
      </p>

      <textarea
        v-model="promptInput"
        rows="10"
        class="mt-4 w-full resize-y rounded-lg border border-zinc-600 bg-zinc-800 px-4 py-3 font-mono text-sm text-white outline-none transition focus:border-blue-500"
      />

      <div class="mt-4 flex items-center gap-3">
        <button
          type="button"
          class="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="isSubmittingPrompt"
          @click="handleSavePrompt"
        >
          儲存
        </button>
        <button
          type="button"
          class="rounded-lg border px-4 py-2 text-sm transition disabled:cursor-not-allowed disabled:opacity-50"
          :class="
            isConfirmingResetPrompt
              ? 'border-red-500 bg-red-600/20 text-red-400 hover:bg-red-600/30'
              : 'border-zinc-600 text-zinc-300 hover:bg-zinc-800 hover:text-white'
          "
          :disabled="isSubmittingPrompt"
          @click="requestResetPrompt"
        >
          {{ isConfirmingResetPrompt ? '確認重置？' : '重置為預設' }}
        </button>
      </div>

      <transition name="feedback-fade">
        <p
          v-if="promptFeedback.message.value !== ''"
          class="mt-3 text-sm"
          :class="
            promptFeedback.type.value === 'success'
              ? 'text-green-400'
              : 'text-red-400'
          "
        >
          {{ promptFeedback.message.value }}
        </p>
      </transition>
    </section>

    <!-- 應用程式 -->
    <section class="mt-6 rounded-xl border border-zinc-700 bg-zinc-900 p-5">
      <h2 class="text-lg font-semibold text-white">應用程式</h2>

      <div class="mt-4 flex items-center justify-between">
        <div>
          <p class="text-sm text-white">開機自啟動</p>
          <p class="text-xs text-zinc-400">開機時自動啟動 SayIt</p>
        </div>
        <button
          type="button"
          class="relative h-6 w-11 rounded-full transition"
          :class="
            settingsStore.isAutoStartEnabled ? 'bg-blue-600' : 'bg-zinc-600'
          "
          :disabled="isTogglingAutoStart"
          @click="handleToggleAutoStart"
        >
          <span
            class="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform"
            :class="
              settingsStore.isAutoStartEnabled
                ? 'translate-x-5'
                : 'translate-x-0'
            "
          />
        </button>
      </div>

      <transition name="feedback-fade">
        <p
          v-if="autoStartFeedback.message.value !== ''"
          class="mt-3 text-sm"
          :class="
            autoStartFeedback.type.value === 'success'
              ? 'text-green-400'
              : 'text-red-400'
          "
        >
          {{ autoStartFeedback.message.value }}
        </p>
      </transition>
    </section>
  </div>
</template>

<style scoped>
.feedback-fade-enter-active,
.feedback-fade-leave-active {
  transition: opacity 180ms ease;
}

.feedback-fade-enter-from,
.feedback-fade-leave-to {
  opacity: 0;
}
</style>
