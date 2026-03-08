<script setup lang="ts">
import { invoke } from "@tauri-apps/api/core";
import { nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import { captureError } from "@/lib/sentry";

const PERMISSION_CHECK_INTERVAL_MS = 2000;

const props = defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  close: [];
}>();

const dialogRef = ref<HTMLDivElement | null>(null);
const primaryButtonRef = ref<InstanceType<typeof Button> | null>(null);
const isReinitializing = ref(false);
const reinitializeError = ref<string | null>(null);
const { t } = useI18n();

let pollingTimer: ReturnType<typeof setInterval> | null = null;

function startPermissionPolling() {
  stopPermissionPolling();
  pollingTimer = setInterval(async () => {
    if (isReinitializing.value) return;
    try {
      const hasPermission = await invoke<boolean>(
        "check_accessibility_permission_command",
      );
      if (hasPermission) {
        stopPermissionPolling();
        await handlePermissionGranted();
      }
    } catch (error) {
      console.error("[accessibility-guide] Permission check failed:", error);
      captureError(error, { source: "accessibility", step: "check-permission" });
    }
  }, PERMISSION_CHECK_INTERVAL_MS);
}

function stopPermissionPolling() {
  if (pollingTimer !== null) {
    clearInterval(pollingTimer);
    pollingTimer = null;
  }
}

async function handlePermissionGranted() {
  isReinitializing.value = true;
  reinitializeError.value = null;
  try {
    await invoke("reinitialize_hotkey_listener");
    emit("close");
  } catch (error) {
    console.error("[accessibility-guide] Reinitialize failed:", error);
    captureError(error, { source: "accessibility", step: "reinitialize" });
    reinitializeError.value = t("accessibility.reinitializeError");
  } finally {
    isReinitializing.value = false;
  }
}

watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      reinitializeError.value = null;
      nextTick(() => {
        const el = primaryButtonRef.value?.$el as HTMLElement | undefined;
        el?.focus();
      });
      startPermissionPolling();
    } else {
      stopPermissionPolling();
    }
  },
);

onBeforeUnmount(() => {
  stopPermissionPolling();
});

function handleKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    emit("close");
    return;
  }

  if (event.key === "Tab" && dialogRef.value) {
    const focusableList =
      dialogRef.value.querySelectorAll<HTMLElement>("button");
    if (focusableList.length === 0) return;

    const firstElement = focusableList[0];
    const lastElement = focusableList[focusableList.length - 1];

    if (event.shiftKey && document.activeElement === firstElement) {
      event.preventDefault();
      lastElement.focus();
    } else if (!event.shiftKey && document.activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  }
}

async function handleOpenAccessibilitySettings() {
  try {
    await invoke("open_accessibility_settings");
  } catch (error) {
    console.error("[accessibility-guide] Failed to open settings:", error);
    captureError(error, { source: "accessibility", step: "open-settings" });
  }
}
</script>

<template>
  <div
    v-if="visible"
    ref="dialogRef"
    role="dialog"
    aria-modal="true"
    aria-labelledby="accessibility-guide-title"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
    @keydown="handleKeydown"
  >
    <div class="mx-4 w-full max-w-md rounded-2xl bg-card p-8 shadow-2xl">
      <h2
        id="accessibility-guide-title"
        class="text-xl font-semibold text-card-foreground"
      >
        {{ $t("accessibility.title") }}
      </h2>
      <p class="mt-3 text-sm leading-relaxed text-muted-foreground">
        {{ $t("accessibility.description") }}
      </p>
      <ol class="mt-4 list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
        <li>{{ $t("accessibility.step1") }}</li>
        <li>{{ $t("accessibility.step2") }}</li>
        <li>{{ $t("accessibility.step3") }}</li>
      </ol>

      <p v-if="isReinitializing" class="mt-3 text-sm text-primary">
        {{ $t("accessibility.reinitializing") }}
      </p>
      <p v-if="reinitializeError" class="mt-3 text-sm text-destructive">
        {{ reinitializeError }}
      </p>

      <div class="mt-6 flex gap-3">
        <Button
          ref="primaryButtonRef"
          :disabled="isReinitializing"
          @click="handleOpenAccessibilitySettings"
        >
          {{ $t("accessibility.openSettings") }}
        </Button>
        <Button
          variant="outline"
          :disabled="isReinitializing"
          @click="emit('close')"
        >
          {{ $t("accessibility.later") }}
        </Button>
      </div>
    </div>
  </div>
</template>
