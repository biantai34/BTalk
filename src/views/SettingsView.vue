<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import { useSettingsStore } from "../stores/useSettingsStore";

function extractErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const settingsStore = useSettingsStore();

const apiKeyInput = ref("");
const isApiKeyVisible = ref(false);
const isSubmittingApiKey = ref(false);
const feedbackMessage = ref("");
const feedbackType = ref<"success" | "error" | "">("");

let feedbackTimer: ReturnType<typeof setTimeout> | null = null;

const apiKeyStatusLabel = computed(() =>
  settingsStore.hasApiKey ? "已設定" : "未設定",
);
const apiKeyStatusClass = computed(() =>
  settingsStore.hasApiKey
    ? "bg-green-500/20 text-green-400"
    : "bg-red-500/20 text-red-400",
);
const shouldShowOnboardingHint = computed(() => !settingsStore.hasApiKey);

function clearFeedbackTimer() {
  if (!feedbackTimer) {
    return;
  }
  clearTimeout(feedbackTimer);
  feedbackTimer = null;
}

function showFeedbackMessage(type: "success" | "error", message: string) {
  clearFeedbackTimer();
  feedbackType.value = type;
  feedbackMessage.value = message;
  feedbackTimer = setTimeout(() => {
    feedbackMessage.value = "";
    feedbackType.value = "";
  }, 2500);
}

function toggleApiKeyVisibility() {
  isApiKeyVisible.value = !isApiKeyVisible.value;
}

async function handleSaveApiKey() {
  try {
    isSubmittingApiKey.value = true;
    await settingsStore.saveApiKey(apiKeyInput.value);
    apiKeyInput.value = "";
    showFeedbackMessage("success", "API Key 已儲存");
  } catch (err) {
    const message = extractErrorMessage(err);
    showFeedbackMessage("error", message);
  } finally {
    isSubmittingApiKey.value = false;
  }
}

async function handleDeleteApiKey() {
  const isDeletionConfirmed = window.confirm("確定要刪除已儲存的 API Key 嗎？");
  if (!isDeletionConfirmed) {
    return;
  }

  try {
    isSubmittingApiKey.value = true;
    await settingsStore.deleteApiKey();
    apiKeyInput.value = "";
    showFeedbackMessage("success", "API Key 已刪除");
  } catch (err) {
    const message = extractErrorMessage(err);
    showFeedbackMessage("error", message);
  } finally {
    isSubmittingApiKey.value = false;
  }
}

onBeforeUnmount(() => {
  clearFeedbackTimer();
});
</script>

<template>
  <div class="p-6 text-white">
    <h1 class="text-2xl font-bold text-white">設定</h1>
    <p class="mt-2 text-zinc-400">快捷鍵、API Key 與應用程式偏好</p>

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
            v-if="feedbackMessage !== ''"
            class="text-sm"
            :class="
              feedbackType === 'success' ? 'text-green-400' : 'text-red-400'
            "
          >
            {{ feedbackMessage }}
          </p>
        </transition>

        <button
          v-if="settingsStore.hasApiKey"
          type="button"
          class="rounded-lg bg-red-600/20 px-4 py-2 text-sm text-red-400 transition hover:bg-red-600/30 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="isSubmittingApiKey"
          @click="handleDeleteApiKey"
        >
          刪除 API Key
        </button>
      </div>
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
