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
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, ChevronDown, Copy, Check, Trash2 } from "lucide-vue-next";

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
  <div class="p-6">
    <!-- 頁面標頭 -->
    <div class="flex items-center justify-between mb-6">
      <div>
        <h2 class="text-xl font-semibold text-foreground">歷史記錄</h2>
        <p class="text-sm text-muted-foreground">瀏覽與搜尋轉錄歷史</p>
      </div>
      <div class="relative">
        <Search class="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          v-model="searchInput"
          type="text"
          placeholder="搜尋轉錄記錄..."
          class="w-70 pl-9"
          @input="handleSearchInput"
        />
      </div>
    </div>

    <!-- 歷史記錄卡片 -->
    <Card>
      <CardContent class="p-0">
        <!-- 載入狀態（初次載入） -->
        <div
          v-if="historyStore.isLoading && historyStore.transcriptionList.length === 0"
          class="text-center text-muted-foreground py-12"
        >
          載入中...
        </div>

        <!-- 空狀態 -->
        <div
          v-else-if="historyStore.transcriptionList.length === 0"
          class="py-12 text-center text-muted-foreground"
        >
          <template v-if="searchInput.trim()">
            找不到符合「{{ searchInput.trim() }}」的記錄
          </template>
          <template v-else>
            尚無轉錄記錄，開始使用語音輸入吧！
          </template>
        </div>

        <!-- 記錄列表 -->
        <template v-else>
          <div
            v-for="(record, index) in historyStore.transcriptionList"
            :key="record.id"
          >
            <!-- 摘要行（可點擊展開） -->
            <div
              class="px-5 py-4 cursor-pointer hover:bg-accent/50 transition"
              :class="{ 'border-b border-border': index < historyStore.transcriptionList.length - 1 || expandedRecordId === record.id }"
              @click="toggleExpand(record.id)"
            >
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <span class="text-xs text-muted-foreground">
                    {{ formatTimestamp(record.timestamp) }}
                  </span>
                  <Badge
                    v-if="record.wasEnhanced"
                    class="bg-purple-500/20 text-purple-400 border-0 text-[11px]"
                  >
                    AI 整理
                  </Badge>
                </div>
                <div class="flex items-center gap-2">
                  <span class="text-xs text-muted-foreground">
                    {{ formatDuration(record.recordingDurationMs) }}
                  </span>
                  <ChevronDown
                    class="h-3.5 w-3.5 text-muted-foreground transition-transform"
                    :class="{ 'rotate-180': expandedRecordId === record.id }"
                  />
                </div>
              </div>
              <p class="mt-1.5 text-sm text-muted-foreground truncate">
                {{ truncateText(getDisplayText(record)) }}
              </p>
            </div>

            <!-- 展開詳細 -->
            <div
              v-if="expandedRecordId === record.id"
              class="bg-card px-5 py-4 space-y-3"
              :class="{ 'border-b border-border': index < historyStore.transcriptionList.length - 1 }"
            >
              <!-- 整理後文字 -->
              <div v-if="record.wasEnhanced && record.processedText">
                <p class="text-xs font-medium text-purple-400 mb-1">整理後文字</p>
                <p class="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
                  {{ record.processedText }}
                </p>
              </div>

              <!-- 原始文字 -->
              <div>
                <p class="text-xs font-medium text-muted-foreground mb-1">原始文字</p>
                <p class="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
                  {{ record.rawText }}
                </p>
              </div>

              <!-- 詳細資訊 -->
              <div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground border-t border-border pt-3">
                <span>錄音：{{ formatDurationMs(record.recordingDurationMs) }}</span>
                <span>轉錄：{{ formatDurationMs(record.transcriptionDurationMs) }}</span>
                <span v-if="record.enhancementDurationMs !== null">
                  AI：{{ formatDurationMs(record.enhancementDurationMs) }}
                </span>
                <span>字數：{{ record.charCount }}</span>
                <span>模式：{{ record.triggerMode === "hold" ? "長按" : "切換" }}</span>
              </div>

              <!-- 操作按鈕 -->
              <div class="flex justify-end gap-2 mt-3">
                <Button
                  variant="outline"
                  size="sm"
                  @click.stop="handleCopyText(record)"
                >
                  <Check v-if="copiedRecordId === record.id" class="h-3.5 w-3.5 mr-1.5" />
                  <Copy v-else class="h-3.5 w-3.5 mr-1.5" />
                  {{ copiedRecordId === record.id ? "已複製" : "複製" }}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  class="text-destructive border-destructive hover:bg-destructive/10"
                >
                  <Trash2 class="h-3.5 w-3.5 mr-1.5" />
                  刪除
                </Button>
              </div>
            </div>
          </div>
        </template>

        <!-- 載入更多指示 -->
        <div
          v-if="historyStore.isLoading && historyStore.transcriptionList.length > 0"
          class="py-4 text-center text-sm text-muted-foreground"
        >
          載入更多...
        </div>

        <!-- 無限捲動 sentinel -->
        <div ref="sentinelRef" class="h-4" />
      </CardContent>
    </Card>
  </div>
</template>
