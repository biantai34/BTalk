<script setup lang="ts">
import { onBeforeUnmount, onMounted } from "vue";
import { useRouter } from "vue-router";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { useHistoryStore } from "../stores/useHistoryStore";
import {
  listenToEvent,
  TRANSCRIPTION_COMPLETED,
} from "../composables/useTauriEvents";
import {
  formatTimestamp,
  truncateText,
  getDisplayText,
  formatDurationFromMs,
  formatNumber,
  formatCostCeiling,
} from "../lib/formatUtils";
import DashboardUsageChart from "../components/DashboardUsageChart.vue";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const historyStore = useHistoryStore();
const router = useRouter();

let unlistenTranscriptionCompleted: UnlistenFn | null = null;

function navigateToHistory() {
  void router.push("/history");
}

onMounted(async () => {
  await historyStore.refreshDashboard();

  unlistenTranscriptionCompleted = await listenToEvent(
    TRANSCRIPTION_COMPLETED,
    () => {
      void historyStore.refreshDashboard();
    },
  );
});

onBeforeUnmount(() => {
  unlistenTranscriptionCompleted?.();
});
</script>

<template>
  <div class="p-6">
    <!-- 頁面標題 -->
    <div class="space-y-1">
      <h2 class="text-xl font-semibold text-foreground">Dashboard</h2>
      <p class="text-sm text-muted-foreground">語音轉文字統計總覽</p>
    </div>

    <!-- 統計卡片 -->
    <div class="mt-6 grid grid-cols-3 gap-4">
      <Card>
        <CardHeader class="pb-2">
          <CardDescription>總口述時間</CardDescription>
        </CardHeader>
        <CardContent>
          <p class="text-2xl font-bold text-foreground">
            {{ formatDurationFromMs(historyStore.dashboardStats.totalRecordingDurationMs) }}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader class="pb-2">
          <CardDescription>口述字數</CardDescription>
        </CardHeader>
        <CardContent>
          <p class="text-2xl font-bold text-foreground">
            {{ formatNumber(historyStore.dashboardStats.totalCharacters) }} 字
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader class="pb-2">
          <CardDescription>節省時間</CardDescription>
        </CardHeader>
        <CardContent>
          <p class="text-2xl font-bold text-foreground">
            {{ formatDurationFromMs(historyStore.dashboardStats.estimatedTimeSavedMs) }}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader class="pb-2">
          <CardDescription>總使用次數</CardDescription>
        </CardHeader>
        <CardContent>
          <p class="text-2xl font-bold text-foreground">
            {{ formatNumber(historyStore.dashboardStats.totalTranscriptions) }} 次
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader class="pb-2">
          <CardDescription>平均每次字數</CardDescription>
        </CardHeader>
        <CardContent>
          <p class="text-2xl font-bold text-foreground">
            {{ historyStore.dashboardStats.totalTranscriptions > 0 ? formatNumber(Math.round(historyStore.dashboardStats.totalCharacters / historyStore.dashboardStats.totalTranscriptions)) : 0 }} 字
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader class="pb-2">
          <CardDescription>API 費用上限</CardDescription>
        </CardHeader>
        <CardContent>
          <p class="text-2xl font-bold text-foreground">
            {{ formatCostCeiling(historyStore.dashboardStats.totalCostCeiling) }}
          </p>
          <p class="text-xs text-muted-foreground mt-1">實際費用不超過此金額</p>
        </CardContent>
      </Card>
    </div>

    <!-- 每日使用趨勢圖表 -->
    <Card class="mt-6">
      <CardHeader>
        <CardTitle class="text-base">每日使用趨勢</CardTitle>
        <CardDescription>最近 30 天</CardDescription>
      </CardHeader>
      <CardContent>
        <DashboardUsageChart :data="historyStore.dailyUsageTrendList" />
      </CardContent>
    </Card>

    <!-- 最近轉錄 -->
    <Card class="mt-6">
      <CardHeader class="flex-row items-center justify-between">
        <CardTitle class="text-base">最近轉錄</CardTitle>
        <Button
          v-if="historyStore.recentTranscriptionList.length > 0"
          variant="link"
          @click="navigateToHistory"
        >
          查看全部
        </Button>
      </CardHeader>
      <CardContent>
        <!-- 空狀態 -->
        <div
          v-if="historyStore.recentTranscriptionList.length === 0"
          class="rounded-lg border border-dashed border-border px-4 py-8 text-center text-muted-foreground"
        >
          開始使用語音輸入，統計數據將在此顯示
        </div>

        <!-- 最近列表 -->
        <div v-else class="space-y-2">
          <button
            v-for="record in historyStore.recentTranscriptionList"
            :key="record.id"
            type="button"
            class="w-full rounded-lg border border-border px-4 py-3 text-left transition hover:bg-accent"
            @click="navigateToHistory"
          >
            <div class="flex items-center justify-between gap-2">
              <span class="text-xs text-muted-foreground">
                {{ formatTimestamp(record.timestamp) }}
              </span>
              <Badge
                v-if="record.wasEnhanced"
                class="bg-purple-500/20 text-purple-400 border-0"
              >
                AI 整理
              </Badge>
            </div>
            <p class="mt-1 text-sm text-muted-foreground truncate">
              {{ truncateText(getDisplayText(record)) }}
            </p>
          </button>
        </div>
      </CardContent>
    </Card>
  </div>
</template>
