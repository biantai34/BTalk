<script setup lang="ts">
import { computed, ref, watch, onUnmounted, toRef } from "vue";
import type { HudStatus } from "../types";
import type { AudioAnalyserHandle } from "../types/audio";
import { useAudioWaveform } from "../composables/useAudioWaveform";

type VisualMode =
  | "hidden"
  | "recording"
  | "morphing"
  | "transcribing"
  | "success"
  | "error";

const props = defineProps<{
  status: HudStatus;
  analyserHandle: AudioAnalyserHandle | null;
  recordingElapsedSeconds: number;
}>();

defineEmits<{
  retry: [];
}>();

const visualMode = ref<VisualMode>("hidden");
let morphingTimer: ReturnType<typeof setTimeout> | null = null;

const analyserHandleRef = toRef(props, "analyserHandle");
const { waveformLevelList, startWaveformAnimation, stopWaveformAnimation } =
  useAudioWaveform(analyserHandleRef);

const WAVEFORM_ELEMENT_COUNT = 6;
const MIN_BAR_HEIGHT = 4;
const MAX_BAR_HEIGHT = 28;

interface NotchShapeParams {
  width: number;
  height: number;
  topRadius: number;
  bottomRadius: number;
}

const NOTCH_SHAPES: Record<string, NotchShapeParams> = {
  hidden: { width: 350, height: 42, topRadius: 14, bottomRadius: 22 },
  recording: { width: 350, height: 42, topRadius: 14, bottomRadius: 22 },
  morphing: { width: 350, height: 42, topRadius: 14, bottomRadius: 22 },
  transcribing: { width: 350, height: 42, topRadius: 14, bottomRadius: 22 },
  success: { width: 350, height: 42, topRadius: 14, bottomRadius: 22 },
  error: { width: 350, height: 42, topRadius: 14, bottomRadius: 22 },
};

function buildNotchPath(p: NotchShapeParams): string {
  const { width: w, height: h, topRadius: tr, bottomRadius: br } = p;
  return `path('M 0,0 Q ${tr},0 ${tr},${tr} L ${tr},${h - br} Q ${tr},${h} ${tr + br},${h} L ${w - tr - br},${h} Q ${w - tr},${h} ${w - tr},${h - br} L ${w - tr},${tr} Q ${w - tr},0 ${w},0 Z')`;
}

const notchStyle = computed(() => {
  const params = NOTCH_SHAPES[visualMode.value] ?? NOTCH_SHAPES.hidden;
  return {
    width: `${params.width}px`,
    height: `${params.height}px`,
    clipPath: buildNotchPath(params),
  };
});

const formattedElapsedTime = computed(() => {
  const totalSeconds = props.recordingElapsedSeconds;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
});

const barStyleList = computed(() => {
  const styleList: Record<string, string>[] = [];
  for (let i = 0; i < WAVEFORM_ELEMENT_COUNT; i++) {
    if (visualMode.value === "recording") {
      const level = waveformLevelList.value[i] ?? 0;
      const height =
        MIN_BAR_HEIGHT + level * (MAX_BAR_HEIGHT - MIN_BAR_HEIGHT);
      styleList.push({
        height: `${Math.round(height)}px`,
        width: "4px",
        borderRadius: "2px",
      });
    } else {
      styleList.push({});
    }
  }
  return styleList;
});

const waveformElementClass = computed(() => {
  switch (visualMode.value) {
    case "recording":
      return "waveform-bar";
    case "morphing":
      return "waveform-morphing";
    case "transcribing":
      return "waveform-dot";
    case "success":
      return "waveform-converge";
    case "error":
      return "waveform-scatter";
    default:
      return "";
  }
});

const notchHudClassList = computed(() => ({
  "notch-shake": visualMode.value === "error",
  "notch-green-flash": visualMode.value === "success",
  "notch-orange-flash": visualMode.value === "error",
}));

function clearMorphingTimer() {
  if (morphingTimer) {
    clearTimeout(morphingTimer);
    morphingTimer = null;
  }
}

watch(
  () => props.status,
  (nextStatus) => {
    clearMorphingTimer();

    if (nextStatus === "idle") {
      stopWaveformAnimation();
      visualMode.value = "hidden";
      return;
    }

    if (nextStatus === "recording") {
      visualMode.value = "recording";
      startWaveformAnimation();
      return;
    }

    if (nextStatus === "transcribing" || nextStatus === "enhancing") {
      stopWaveformAnimation();
      if (
        visualMode.value === "recording" ||
        visualMode.value === "morphing"
      ) {
        visualMode.value = "morphing";
        morphingTimer = setTimeout(() => {
          visualMode.value = "transcribing";
        }, 300);
      } else {
        visualMode.value = "transcribing";
      }
      return;
    }

    if (nextStatus === "success") {
      stopWaveformAnimation();
      visualMode.value = "success";
      return;
    }

    if (nextStatus === "error") {
      stopWaveformAnimation();
      visualMode.value = "error";
    }
  },
  { immediate: true },
);

onUnmounted(() => {
  clearMorphingTimer();
  stopWaveformAnimation();
});
</script>

<template>
  <div
    v-if="visualMode !== 'hidden'"
    class="notch-wrapper"
    :class="{ 'notch-wrapper-success': visualMode === 'success' }"
  >
    <div
      class="notch-hud"
      :class="notchHudClassList"
      :style="notchStyle"
    >
      <div class="notch-content">
        <div class="notch-left">
          <div class="waveform-container">
            <span
              v-for="(style, index) in barStyleList"
              :key="index"
              class="waveform-element"
              :class="waveformElementClass"
              :style="style"
            />
          </div>
          <svg
            v-if="visualMode === 'success'"
            class="checkmark-svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
          >
            <path
              d="M4 12l6 6L20 6"
              fill="none"
              stroke="#22c55e"
              stroke-width="3"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </div>

        <div class="notch-camera-gap" />

        <div class="notch-right">
          <span v-if="visualMode === 'recording'" class="elapsed-timer">
            {{ formattedElapsedTime }}
          </span>
          <span
            v-else-if="visualMode === 'error'"
            class="retry-icon"
            @click.stop="$emit('retry')"
          >&#x21BB;</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.notch-wrapper {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  display: flex;
  justify-content: center;
  filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.3));
}

.notch-hud {
  background: black;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: notchEnter 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
  transition:
    width 0.35s cubic-bezier(0.32, 0.72, 0, 1),
    height 0.35s cubic-bezier(0.32, 0.72, 0, 1),
    clip-path 0.35s cubic-bezier(0.32, 0.72, 0, 1),
    background 0.3s ease;
}

@keyframes notchEnter {
  from {
    opacity: 0;
    transform: scaleX(0.6) scaleY(0.3);
  }
  to {
    opacity: 1;
    transform: scaleX(1) scaleY(1);
  }
}

.notch-content {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 0 40px;
}

.notch-left {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  position: relative;
}

.notch-camera-gap {
  width: 40px;
  flex-shrink: 0;
}

.notch-right {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: flex-end;
}

/* ---- Waveform Container ---- */
.waveform-container {
  display: flex;
  align-items: center;
  gap: 3px;
  height: 28px;
}

/* ---- Shared Waveform Element ---- */
.waveform-element {
  background: white;
  transition:
    height 0.3s cubic-bezier(0.32, 0.72, 0, 1),
    width 0.3s cubic-bezier(0.32, 0.72, 0, 1),
    border-radius 0.3s cubic-bezier(0.32, 0.72, 0, 1),
    opacity 0.3s ease,
    transform 0.3s ease;
}

/* Recording: dynamic bars */
.waveform-bar {
  /* height & width set via inline style */
}

/* ---- Gap 2: Morphing stagger delay ---- */
.waveform-morphing {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}
.waveform-morphing:nth-child(1) { transition-delay: 0ms; }
.waveform-morphing:nth-child(2) { transition-delay: 50ms; }
.waveform-morphing:nth-child(3) { transition-delay: 100ms; }
.waveform-morphing:nth-child(4) { transition-delay: 150ms; }
.waveform-morphing:nth-child(5) { transition-delay: 200ms; }
.waveform-morphing:nth-child(6) { transition-delay: 250ms; }

/* ---- Gap 3: Transcribing dots sliding window ---- */
.waveform-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  animation: dotSlide 1.5s ease-in-out infinite;
}
.waveform-dot:nth-child(1) { animation-delay: 0s; }
.waveform-dot:nth-child(2) { animation-delay: 0.3s; }
.waveform-dot:nth-child(3) { animation-delay: 0.6s; }
.waveform-dot:nth-child(4) { animation-delay: 0.9s; }
.waveform-dot:nth-child(5) { animation-delay: 1.2s; }
.waveform-dot:nth-child(6) {
  display: none;
}

@keyframes dotSlide {
  0%       { opacity: 1; }
  60%      { opacity: 1; }
  60.01%   { opacity: 0.2; }
  100%     { opacity: 0.2; }
}

/* ---- Success: converge + SVG checkmark ---- */
.waveform-converge {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  animation: dotConverge 0.35s ease-in forwards;
}
.waveform-converge:nth-child(1) { --converge-offset: -12px; }
.waveform-converge:nth-child(2) { --converge-offset: -7px; }
.waveform-converge:nth-child(3) { --converge-offset: -3px; }
.waveform-converge:nth-child(4) { --converge-offset: 3px; }
.waveform-converge:nth-child(5) { --converge-offset: 7px; }
.waveform-converge:nth-child(6) { --converge-offset: 12px; }

@keyframes dotConverge {
  from { transform: translateX(var(--converge-offset)) scale(1); opacity: 1; }
  to   { transform: translateX(0) scale(0); opacity: 0; }
}

/* Gap 5: SVG checkmark stroke animation */
.checkmark-svg {
  position: absolute;
  left: 0;
}
.checkmark-svg path {
  stroke-dasharray: 30;
  stroke-dashoffset: 30;
  animation: drawCheck 0.3s ease-out 0.35s forwards;
}
@keyframes drawCheck {
  to { stroke-dashoffset: 0; }
}

/* ---- Success: green glow from notch edge ---- */
.notch-wrapper-success {
  filter:
    drop-shadow(0 4px 12px rgba(0, 0, 0, 0.3))
    drop-shadow(0 0 10px rgba(34, 197, 94, 0.5))
    drop-shadow(0 0 25px rgba(34, 197, 94, 0.2));
  animation: successGlow 0.8s ease-out forwards;
}

@keyframes successGlow {
  0% {
    filter:
      drop-shadow(0 4px 12px rgba(0, 0, 0, 0.3))
      drop-shadow(0 0 12px rgba(34, 197, 94, 0.6))
      drop-shadow(0 0 30px rgba(34, 197, 94, 0.3));
  }
  100% {
    filter:
      drop-shadow(0 4px 12px rgba(0, 0, 0, 0.3))
      drop-shadow(0 0 2px rgba(34, 197, 94, 0));
  }
}

/* ---- Success flash ---- */
.notch-green-flash {
  animation:
    notchEnter 0.25s cubic-bezier(0.34, 1.56, 0.64, 1),
    greenFlash 0.6s ease-out;
}

/* Gap 6: correct green color */
@keyframes greenFlash {
  0% {
    background: rgba(34, 197, 94, 0.4);
  }
  100% {
    background: black;
  }
}

/* ---- Error: scatter + shake ---- */
.waveform-scatter {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #f97316;
  animation: dotScatter 0.4s ease-out forwards;
}
.waveform-scatter:nth-child(1) { --scatter-offset: -6; }
.waveform-scatter:nth-child(2) { --scatter-offset: -3; }
.waveform-scatter:nth-child(3) { --scatter-offset: 0; }
.waveform-scatter:nth-child(4) { --scatter-offset: 3; }
.waveform-scatter:nth-child(5) { --scatter-offset: 6; }
.waveform-scatter:nth-child(6) { --scatter-offset: 9; }

@keyframes dotScatter {
  from {
    transform: translateX(0) scale(1);
    opacity: 1;
  }
  to {
    transform: translateX(calc(var(--scatter-offset) * 1px)) scale(0.8);
    opacity: 0.7;
  }
}

.notch-shake {
  animation:
    notchEnter 0.25s cubic-bezier(0.34, 1.56, 0.64, 1),
    notchShake 0.4s ease-out 0.1s,
    orangeFlash 0.6s ease-out;
}

@keyframes notchShake {
  0%, 100% { transform: translateX(0); }
  20% { transform: translateX(-4px); }
  40% { transform: translateX(4px); }
  60% { transform: translateX(-3px); }
  80% { transform: translateX(2px); }
}

/* Gap 6: correct orange color */
@keyframes orangeFlash {
  0% {
    background: rgba(249, 115, 22, 0.4);
  }
  100% {
    background: black;
  }
}

/* ---- Gap 7: Timer font ---- */
.elapsed-timer {
  font-family: 'JetBrains Mono', monospace;
  color: rgba(255, 255, 255, 0.6);
  font-size: 12px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}

/* ---- Retry Icon ---- */
.retry-icon {
  color: #f97316;
  font-size: 16px;
  cursor: pointer;
}
</style>
