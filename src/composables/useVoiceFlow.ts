import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import {
  initializeMicrophone,
  startRecording,
  stopRecording,
} from "../lib/recorder";
import { transcribeAudio } from "../lib/transcriber";
import { API_KEY_MISSING_ERROR } from "../lib/errorUtils";
import { useHudState } from "./useHudState";
import {
  emitEvent,
  HOTKEY_PRESSED,
  HOTKEY_RELEASED,
  HOTKEY_TOGGLED,
  HOTKEY_ERROR,
  VOICE_FLOW_STATE_CHANGED,
} from "./useTauriEvents";
import type { HotkeyEventPayload, HotkeyErrorPayload } from "../types/events";
import { useSettingsStore } from "../stores/useSettingsStore";
import { extractErrorMessage } from "../lib/errorUtils";

function log(message: string) {
  invoke("debug_log", { level: "info", message });
}

function logError(message: string) {
  invoke("debug_log", { level: "error", message });
}

export function useVoiceFlow() {
  const { state, transitionTo } = useHudState();
  const settingsStore = useSettingsStore();
  let isRecording = false;
  const unlistenFunctions: UnlistenFn[] = [];

  async function initialize() {
    log("useVoiceFlow: initializing...");

    // Load saved hotkey settings and sync to Rust
    await settingsStore.loadSettings();
    log("useVoiceFlow: settings loaded");

    try {
      await initializeMicrophone();
      log("useVoiceFlow: microphone initialized OK");
    } catch (err) {
      logError(
        `useVoiceFlow: microphone init failed: ${extractErrorMessage(err)}`,
      );
    }

    // Hold mode: press to start, release to stop
    unlistenFunctions.push(
      await listen(HOTKEY_PRESSED, () => {
        log(`useVoiceFlow: received ${HOTKEY_PRESSED}`);
        handleStartRecording();
      }),
    );

    unlistenFunctions.push(
      await listen(HOTKEY_RELEASED, () => {
        log(`useVoiceFlow: received ${HOTKEY_RELEASED}`);
        handleStopRecording();
      }),
    );

    // Toggle mode: first press starts, second press stops
    unlistenFunctions.push(
      await listen<HotkeyEventPayload>(HOTKEY_TOGGLED, (event) => {
        const { action } = event.payload;
        log(`useVoiceFlow: received ${HOTKEY_TOGGLED} action=${action}`);
        if (action === "start") {
          handleStartRecording();
        } else {
          handleStopRecording();
        }
      }),
    );

    // Hotkey system error (e.g. missing Accessibility permission)
    unlistenFunctions.push(
      await listen<HotkeyErrorPayload>(HOTKEY_ERROR, (event) => {
        const { message } = event.payload;
        logError(`useVoiceFlow: hotkey error: ${message}`);
        transitionTo("error", "請授予輔助使用權限");
      }),
    );

    log("useVoiceFlow: event listeners registered");
  }

  function cleanup() {
    for (const unlisten of unlistenFunctions) {
      unlisten();
    }
    unlistenFunctions.length = 0;
  }

  async function handleStartRecording() {
    if (isRecording) return;
    isRecording = true;

    try {
      await initializeMicrophone();
      transitionTo("recording", "Recording...");
      startRecording();
      log("useVoiceFlow: recording started");
    } catch (err) {
      isRecording = false;
      const message = err instanceof Error ? err.message : "Recording failed";
      logError(`useVoiceFlow: recording error: ${message}`);
      transitionTo("error", message);
    }
  }

  async function handleStopRecording() {
    if (!isRecording) return;
    isRecording = false;

    try {
      transitionTo("transcribing", "Transcribing...");
      log("useVoiceFlow: stopping recording...");
      const audioBlob = await stopRecording();
      log(
        `useVoiceFlow: got audio blob, size=${audioBlob.size}, type=${audioBlob.type}`,
      );

      const currentApiKey = settingsStore.getApiKey();
      if (!currentApiKey) {
        await emitEvent(VOICE_FLOW_STATE_CHANGED, {
          status: "error",
          message: API_KEY_MISSING_ERROR,
        });
        transitionTo("error", API_KEY_MISSING_ERROR);
        return;
      }

      log("useVoiceFlow: calling transcribeAudio...");
      const result = await transcribeAudio(audioBlob, currentApiKey);
      log(`useVoiceFlow: transcription result: "${result.text}"`);

      if (!result.text) {
        transitionTo("error", "No speech detected");
        return;
      }

      // Hide HUD before paste so target app regains focus
      transitionTo("idle");
      log("useVoiceFlow: invoking paste_text...");
      await invoke("paste_text", { text: result.text });
      log("useVoiceFlow: paste done!");
      transitionTo("success", "Pasted!");
    } catch (err) {
      const message = extractErrorMessage(err);
      logError(`useVoiceFlow: error: ${message}`);
      transitionTo("error", message);
    }
  }

  return {
    state,
    initialize,
    cleanup,
  };
}
