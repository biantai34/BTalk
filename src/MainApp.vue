<script setup lang="ts">
import { invoke } from "@tauri-apps/api/core";
import {
  BookOpen,
  FileText,
  LayoutDashboard,
  Settings,
} from "lucide-vue-next";
import { computed, markRaw, onMounted, ref } from "vue";
import { RouterLink, RouterView, useRoute } from "vue-router";
import AccessibilityGuide from "./components/AccessibilityGuide.vue";
import SiteHeader from "./components/SiteHeader.vue";

const navItems = [
  { path: "/dashboard", label: "Dashboard", icon: markRaw(LayoutDashboard) },
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

onMounted(async () => {
  const isMacOS = navigator.userAgent.includes("Macintosh");
  if (!isMacOS) return;

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
});
</script>

<template>
  <div class="flex h-screen bg-background text-foreground">
    <!-- Sidebar -->
    <nav class="flex w-56 flex-col border-r border-border bg-sidebar">
      <div class="flex h-14 items-center gap-2 border-b border-border px-4">
        <span class="text-lg font-semibold text-foreground">SayIt</span>
      </div>
      <div class="flex flex-1 flex-col gap-1 p-2">
        <RouterLink
          v-for="item in navItems"
          :key="item.path"
          :to="item.path"
          class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          active-class="!bg-accent !text-foreground"
        >
          <component :is="item.icon" class="h-4 w-4" />
          <span>{{ item.label }}</span>
        </RouterLink>
      </div>
    </nav>

    <!-- Main Content -->
    <main class="flex flex-1 flex-col overflow-hidden">
      <SiteHeader :title="currentPageTitle" />
      <div class="flex-1 overflow-y-auto">
        <RouterView />
      </div>
    </main>

    <AccessibilityGuide
      :visible="showAccessibilityGuide"
      @close="showAccessibilityGuide = false"
    />
  </div>
</template>
