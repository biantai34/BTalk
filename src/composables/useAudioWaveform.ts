import { ref, type Ref } from "vue";
import { useRafFn } from "@vueuse/core";
import type { AudioAnalyserHandle } from "../types/audio";

const WAVEFORM_BAR_COUNT = 6;
const FREQUENCY_BIN_PICK_INDEX_LIST = [1, 3, 5, 8, 12, 16];
const DB_FLOOR = -100;
const DB_CEILING = -20;
const LERP_SPEED = 0.25;

function normalizeDb(db: number): number {
  const clamped = Math.max(DB_FLOOR, Math.min(DB_CEILING, db));
  return (clamped - DB_FLOOR) / (DB_CEILING - DB_FLOOR);
}

function lerp(current: number, target: number, speed: number): number {
  return current + (target - current) * speed;
}

export function useAudioWaveform(
  analyserHandle: Ref<AudioAnalyserHandle | null>,
) {
  const waveformLevelList = ref<number[]>(
    new Array(WAVEFORM_BAR_COUNT).fill(0),
  );

  const { pause, resume } = useRafFn(
    () => {
      const handle = analyserHandle.value;
      if (!handle) return;

      const frequencyData = handle.getFrequencyData();
      if (frequencyData.length === 0) return;

      const nextLevelList = [...waveformLevelList.value];
      for (let i = 0; i < WAVEFORM_BAR_COUNT; i++) {
        const binIndex = FREQUENCY_BIN_PICK_INDEX_LIST[i];
        const rawDb =
          binIndex < frequencyData.length ? frequencyData[binIndex] : DB_FLOOR;
        const targetLevel = normalizeDb(rawDb);
        nextLevelList[i] = lerp(nextLevelList[i], targetLevel, LERP_SPEED);
      }
      waveformLevelList.value = nextLevelList;
    },
    { immediate: false },
  );

  function startWaveformAnimation(): void {
    resume();
  }

  function stopWaveformAnimation(): void {
    pause();
  }

  return {
    waveformLevelList,
    startWaveformAnimation,
    stopWaveformAnimation,
  };
}
