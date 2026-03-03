<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { useHistoryStore } from "../stores/useHistoryStore";
import {
  listenToEvent,
  TRANSCRIPTION_COMPLETED,
} from "../composables/useTauriEvents";
import type { TranscriptionRecord } from "../types/transcription";
import {
  formatTimestamp,
  truncateText,
  getDisplayText,
  formatDuration,
  formatDurationMs,
} from "../lib/formatUtils";

const historyStore = useHistoryStore();

const searchInput = ref("");
const expandedRecordId = ref<string | null>(null);
const copiedRecordId = ref<string | null>(null);
const sentinelRef = ref<HTMLElement | null>(null);

let searchTimer: ReturnType<typeof setTimeout> | null = null;
let copiedTimer: ReturnType<typeof setTimeout> | null = null;
let observer: IntersectionObserver | null = null;
let unlistenTranscriptionCompleted: UnlistenFn | null = null;

const SEARCH_DEBOUNCE_MS = 300;

function toggleExpand(recordId: string) {
  expandedRecordId.value =
    expandedRecordId.value === recordId ? null : recordId;
}

function handleSearchInput() {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    historyStore.searchQuery = searchInput.value;
    void historyStore.resetAndFetch();
  }, SEARCH_DEBOUNCE_MS);
}

async function handleCopyText(record: TranscriptionRecord) {
  const textToCopy = getDisplayText(record);
  try {
    await navigator.clipboard.writeText(textToCopy);
    if (copiedTimer) clearTimeout(copiedTimer);
    copiedRecordId.value = record.id;
    copiedTimer = setTimeout(() => {
      copiedRecordId.value = null;
    }, 2500);
  } catch {
    // clipboard write may fail in some contexts, silently ignore
  }
}

onMounted(async () => {
  await historyStore.resetAndFetch();

  unlistenTranscriptionCompleted = await listenToEvent(
    TRANSCRIPTION_COMPLETED,
    () => {
      void historyStore.resetAndFetch();
    },
  );

  observer = new IntersectionObserver(
    (entries) => {
      if (
        entries[0].isIntersecting &&
        historyStore.hasMore &&
        !historyStore.isLoading
      ) {
        void historyStore.loadMore();
      }
    },
    { threshold: 0.1 },
  );
  if (sentinelRef.value) {
    observer.observe(sentinelRef.value);
  }
});

onBeforeUnmount(() => {
  unlistenTranscriptionCompleted?.();
  observer?.disconnect();
  if (searchTimer) clearTimeout(searchTimer);
  if (copiedTimer) clearTimeout(copiedTimer);
});
</script>

<template>
  <div class="p-6 text-white">
    <h1 class="text-2xl font-bold text-white">歷史記錄</h1>
    <p class="mt-2 text-zinc-400">瀏覽與搜尋轉錄歷史</p>

    <section class="mt-6 rounded-xl border border-zinc-700 bg-zinc-900 p-5">
      <!-- 搜尋框 -->
      <div class="mb-4">
        <input
          v-model="searchInput"
          type="text"
          placeholder="搜尋轉錄內容..."
          class="w-full rounded-lg border border-zinc-600 bg-zinc-800 px-4 py-2 text-white outline-none transition focus:border-blue-500"
          @input="handleSearchInput"
        />
      </div>

      <!-- 載入狀態（初次載入） -->
      <div
        v-if="historyStore.isLoading && historyStore.transcriptionList.length === 0"
        class="text-center text-zinc-400 py-8"
      >
        載入中...
      </div>

      <!-- 空狀態 -->
      <div
        v-else-if="historyStore.transcriptionList.length === 0"
        class="rounded-lg border border-dashed border-zinc-600 px-4 py-8 text-center text-zinc-400"
      >
        <template v-if="searchInput.trim()">
          找不到符合「{{ searchInput.trim() }}」的記錄
        </template>
        <template v-else>
          尚無轉錄記錄，開始使用語音輸入吧！
        </template>
      </div>

      <!-- 記錄列表 -->
      <div v-else class="space-y-2">
        <div
          v-for="record in historyStore.transcriptionList"
          :key="record.id"
          class="rounded-lg border border-zinc-700 transition hover:bg-zinc-800/50"
        >
          <!-- 摘要行（可點擊展開） -->
          <button
            type="button"
            class="w-full px-4 py-3 text-left"
            @click="toggleExpand(record.id)"
          >
            <div class="flex items-center justify-between gap-2">
              <span class="text-sm text-zinc-400">
                {{ formatTimestamp(record.timestamp) }}
              </span>
              <div class="flex items-center gap-2">
                <span
                  v-if="record.wasEnhanced"
                  class="rounded-full bg-purple-500/20 px-2 py-0.5 text-xs font-medium text-purple-400"
                >
                  AI 整理
                </span>
                <span class="text-xs text-zinc-500">
                  {{ formatDuration(record.recordingDurationMs) }}
                </span>
                <span class="text-xs text-zinc-600">
                  {{ expandedRecordId === record.id ? "▲" : "▼" }}
                </span>
              </div>
            </div>
            <p class="mt-1 text-sm text-zinc-300 truncate">
              {{ truncateText(getDisplayText(record)) }}
            </p>
          </button>

          <!-- 展開詳細 -->
          <div
            v-if="expandedRecordId === record.id"
            class="border-t border-zinc-700 px-4 py-3 space-y-3"
          >
            <!-- 整理後文字 -->
            <div v-if="record.wasEnhanced && record.processedText">
              <p class="text-xs font-medium text-purple-400 mb-1">整理後文字</p>
              <p class="text-sm text-white whitespace-pre-wrap leading-relaxed">
                {{ record.processedText }}
              </p>
            </div>

            <!-- 原始文字 -->
            <div>
              <p class="text-xs font-medium text-zinc-400 mb-1">原始文字</p>
              <p class="text-sm text-zinc-300 whitespace-pre-wrap leading-relaxed">
                {{ record.rawText }}
              </p>
            </div>

            <!-- 詳細資訊 -->
            <div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500 border-t border-zinc-700 pt-3">
              <span>錄音：{{ formatDurationMs(record.recordingDurationMs) }}</span>
              <span>轉錄：{{ formatDurationMs(record.transcriptionDurationMs) }}</span>
              <span v-if="record.enhancementDurationMs !== null">
                AI：{{ formatDurationMs(record.enhancementDurationMs) }}
              </span>
              <span>字數：{{ record.charCount }}</span>
              <span>模式：{{ record.triggerMode === "hold" ? "長按" : "切換" }}</span>
            </div>

            <!-- 複製按鈕 -->
            <div class="flex justify-end">
              <button
                type="button"
                class="rounded-lg px-4 py-1.5 text-sm font-medium transition"
                :class="
                  copiedRecordId === record.id
                    ? 'bg-green-600/20 text-green-400'
                    : 'bg-blue-600 text-white hover:bg-blue-500'
                "
                @click.stop="handleCopyText(record)"
              >
                {{ copiedRecordId === record.id ? "已複製" : "複製" }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- 載入更多指示 -->
      <div
        v-if="historyStore.isLoading && historyStore.transcriptionList.length > 0"
        class="mt-4 text-center text-sm text-zinc-400"
      >
        載入更多...
      </div>

      <!-- 無限捲動 sentinel -->
      <div ref="sentinelRef" class="h-4" />
    </section>
  </div>
</template>
