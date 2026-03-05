<script setup lang="ts">
import { invoke } from "@tauri-apps/api/core";
import {
  BookOpen,
  Download,
  FileText,
  LayoutDashboard,
  Settings,
} from "lucide-vue-next";
import { computed, markRaw, onMounted, ref } from "vue";
import { RouterLink, RouterView, useRoute } from "vue-router";
import AccessibilityGuide from "./components/AccessibilityGuide.vue";
import SiteHeader from "./components/SiteHeader.vue";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useFeedbackMessage } from "./composables/useFeedbackMessage";
import type { UpdateCheckResult } from "./lib/autoUpdater";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar";

declare const __APP_VERSION__: string;
const appVersion = __APP_VERSION__;

const navItems = [
  { path: "/dashboard", label: "儀表板", icon: markRaw(LayoutDashboard) },
  { path: "/history", label: "歷史記錄", icon: markRaw(FileText) },
  { path: "/dictionary", label: "自訂字典", icon: markRaw(BookOpen) },
  { path: "/settings", label: "設定", icon: markRaw(Settings) },
];

const route = useRoute();
const currentPageTitle = computed(() => {
  const item = navItems.find((n) => route.path.startsWith(n.path));
  return item?.label ?? "SayIt";
});

const showAccessibilityGuide = ref(false);

// ── 更新相關狀態 ──
type UpdateUiState = "idle" | "checking" | "downloading" | "ready-to-install" | "installing";
const updateState = ref<UpdateUiState>("idle");
const availableVersion = ref("");
const updateFeedback = useFeedbackMessage();

// AlertDialog 控制
const showManualUpdateDialog = ref(false);
const showAutoInstallDialog = ref(false);

// ── 流程 1：自動偵測（靜默檢查 → 靜默下載 → 通知安裝） ──
async function autoCheckAndDownload() {
  try {
    const { checkForAppUpdate, downloadUpdate } = await import("./lib/autoUpdater");
    const result = await checkForAppUpdate();

    if (result.status !== "update-available" || !result.version) return;

    availableVersion.value = result.version;
    updateState.value = "downloading";

    await downloadUpdate();

    updateState.value = "ready-to-install";
    showAutoInstallDialog.value = true;
  } catch (err) {
    console.error("[main-window] Auto update check/download failed:", err);
    updateState.value = "idle";
  }
}

// 使用者在自動流程的 AlertDialog 中點「安裝並重啟」
async function handleAutoInstall() {
  showAutoInstallDialog.value = false;
  updateState.value = "installing";
  try {
    const { installAndRelaunch } = await import("./lib/autoUpdater");
    await installAndRelaunch();
  } catch (err) {
    console.error("[main-window] Auto install failed:", err);
    updateFeedback.show("error", "安裝失敗，請手動下載更新");
    updateState.value = "idle";
    availableVersion.value = "";
  }
}

// 使用者在自動流程的 AlertDialog 中點「稍後」
function handleAutoInstallLater() {
  showAutoInstallDialog.value = false;
  // 保持 ready-to-install 狀態，sidebar 仍顯示「立即安裝」按鈕
}

// sidebar footer 的「立即安裝」按鈕（自動下載完成後顯示）
async function handleSidebarInstall() {
  showAutoInstallDialog.value = true;
}

// ── 流程 2：手動檢查更新 ──
async function handleManualCheck() {
  if (updateState.value !== "idle" && updateState.value !== "ready-to-install") return;

  // 如果已有待安裝的更新，直接彈 dialog
  if (updateState.value === "ready-to-install") {
    showAutoInstallDialog.value = true;
    return;
  }

  updateState.value = "checking";
  try {
    const { checkForAppUpdate } = await import("./lib/autoUpdater");
    const result = await checkForAppUpdate();
    handleManualCheckResult(result);
  } catch (err) {
    console.error("[main-window] Manual update check failed:", err);
    updateFeedback.show("error", "檢查更新時發生錯誤");
    updateState.value = "idle";
  }
}

function handleManualCheckResult(result: UpdateCheckResult) {
  if (result.status === "up-to-date") {
    updateFeedback.show("success", "已是最新版本");
    updateState.value = "idle";
  } else if (result.status === "update-available") {
    availableVersion.value = result.version ?? "";
    updateState.value = "idle";
    showManualUpdateDialog.value = true;
  } else {
    updateFeedback.show("error", "檢查失敗，請確認網路連線");
    updateState.value = "idle";
  }
}

// 使用者在手動流程的 AlertDialog 中點「開始更新」
async function handleManualUpdate() {
  showManualUpdateDialog.value = false;
  updateState.value = "downloading";
  try {
    const { downloadInstallAndRelaunch } = await import("./lib/autoUpdater");
    await downloadInstallAndRelaunch();
  } catch (err) {
    console.error("[main-window] Manual update failed:", err);
    updateFeedback.show("error", "更新失敗，請手動下載");
    updateState.value = "idle";
    availableVersion.value = "";
  }
}

// ── Sidebar footer 顯示邏輯 ──
const updateButtonLabel = computed(() => {
  switch (updateState.value) {
    case "checking": return "檢查中...";
    case "downloading": return "下載中...";
    case "installing": return "安裝中...";
    default: return "檢查更新";
  }
});

const isUpdateBusy = computed(() =>
  updateState.value === "checking" ||
  updateState.value === "downloading" ||
  updateState.value === "installing"
);


onMounted(async () => {
  // macOS 無障礙權限檢查
  const isMacOS = navigator.userAgent.includes("Macintosh");
  if (isMacOS) {
    try {
      const hasAccessibilityPermission = await invoke<boolean>(
        "check_accessibility_permission_command",
      );
      showAccessibilityGuide.value = !hasAccessibilityPermission;
    } catch (error) {
      console.error(
        "[main-window] Failed to check accessibility permission:",
        error,
      );
    }
  }

  // 自動檢查更新（靜默）
  autoCheckAndDownload();
});
</script>

<template>
  <!-- macOS Overlay 自訂標題列：fixed z-20 蓋住 Sidebar(z-10)，整條可拖動 -->
  <div
    data-tauri-drag-region
    class="fixed top-0 left-0 right-0 z-20 flex h-9 items-center justify-center border-b border-border bg-background"
  >
    <span data-tauri-drag-region class="text-xs font-medium text-muted-foreground select-none">SayIt - 言</span>
  </div>

  <SidebarProvider class="h-screen !min-h-0 pt-9">
    <Sidebar collapsible="offcanvas">
      <SidebarHeader class="flex-row h-12 items-center gap-3 border-b border-sidebar-border px-4">
        <img src="@/assets/logo-yan.png" alt="言" class="h-7 w-auto" />
        <span class="text-base font-semibold text-sidebar-foreground tracking-wide" style="font-family: 'SF Pro Display', 'Inter', system-ui, sans-serif;">SayIt</span>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem v-for="item in navItems" :key="item.path">
                <SidebarMenuButton
                  as-child
                  :is-active="route.path.startsWith(item.path)"
                >
                  <RouterLink :to="item.path">
                    <component :is="item.icon" />
                    <span>{{ item.label }}</span>
                  </RouterLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter class="border-t border-sidebar-border px-4 py-2">
        <div class="flex items-center justify-between">
          <span class="text-xs text-muted-foreground">v{{ appVersion }}</span>
          <!-- ready-to-install 時不顯示檢查按鈕，改顯示安裝提示 -->
          <Button
            v-if="updateState !== 'ready-to-install'"
            variant="link"
            class="h-auto p-0 text-xs text-muted-foreground"
            :disabled="isUpdateBusy"
            @click="handleManualCheck"
          >
            {{ updateButtonLabel }}
          </Button>
        </div>
        <!-- 自動下載完成：顯示持久的安裝提示 -->
        <div v-if="updateState === 'ready-to-install'" class="mt-1.5 flex items-center justify-between rounded-md bg-primary/10 px-2 py-1.5">
          <span class="text-xs font-medium text-primary">v{{ availableVersion }} 已就緒</span>
          <Button
            size="sm"
            class="h-6 gap-1 px-2 text-xs"
            @click="handleSidebarInstall"
          >
            <Download class="h-3 w-3" />
            立即安裝
          </Button>
        </div>
        <p
          v-if="updateFeedback.message.value"
          class="mt-1 text-xs"
          :class="updateFeedback.type.value === 'success' ? 'text-primary' : 'text-destructive'"
        >
          {{ updateFeedback.message.value }}
        </p>
      </SidebarFooter>
    </Sidebar>

    <SidebarInset class="overflow-hidden">
      <SiteHeader :title="currentPageTitle" />
      <div class="flex-1 overflow-y-auto">
        <RouterView />
      </div>
    </SidebarInset>
  </SidebarProvider>

  <AccessibilityGuide
    :visible="showAccessibilityGuide"
    @close="showAccessibilityGuide = false"
  />

  <!-- 自動流程 AlertDialog：更新已下載，詢問是否安裝重啟 -->
  <AlertDialog :open="showAutoInstallDialog">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>更新已就緒</AlertDialogTitle>
        <AlertDialogDescription>
          SayIt v{{ availableVersion }} 已下載完成。安裝後需要重新啟動應用程式。
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel @click="handleAutoInstallLater">稍後</AlertDialogCancel>
        <AlertDialogAction @click="handleAutoInstall">安裝並重啟</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>

  <!-- 手動流程 AlertDialog：發現新版本，詢問是否開始更新 -->
  <AlertDialog :open="showManualUpdateDialog">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>發現新版本</AlertDialogTitle>
        <AlertDialogDescription>
          SayIt v{{ availableVersion }} 已可供更新。點擊開始更新將自動下載並重新啟動應用程式。
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel @click="showManualUpdateDialog = false">取消</AlertDialogCancel>
        <AlertDialogAction @click="handleManualUpdate">開始更新</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
