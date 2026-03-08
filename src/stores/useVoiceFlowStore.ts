import { invoke } from "@tauri-apps/api/core";
import { LogicalPosition } from "@tauri-apps/api/dpi";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Window, getCurrentWindow } from "@tauri-apps/api/window";
import { defineStore } from "pinia";
import { ref } from "vue";
import {
  extractErrorMessage,
  getEnhancementErrorMessage,
  getHotkeyErrorMessage,
  getMicrophoneErrorMessage,
  getTranscriptionErrorMessage,
} from "../lib/errorUtils";
import { captureError } from "../lib/sentry";
import { enhanceText } from "../lib/enhancer";
import i18n from "../i18n";
import { useVocabularyStore } from "./useVocabularyStore";
import { useHistoryStore } from "./useHistoryStore";
import type {
  TranscriptionRecord,
  ChatUsageData,
  ApiUsageRecord,
} from "../types/transcription";
import {
  calculateWhisperCostCeiling,
  calculateChatCostCeiling,
} from "../lib/apiPricing";
import type { StopRecordingResult, TranscriptionResult } from "../types/audio";
import {
  HOTKEY_ERROR,
  HOTKEY_PRESSED,
  HOTKEY_RELEASED,
  HOTKEY_TOGGLED,
  QUALITY_MONITOR_RESULT,
  VOICE_FLOW_STATE_CHANGED,
} from "../composables/useTauriEvents";
import {
  HOTKEY_ERROR_CODES,
  type HotkeyErrorPayload,
  type HotkeyEventPayload,
  type QualityMonitorResultPayload,
} from "../types/events";
import type { HudStatus, HudTargetPosition } from "../types";
import type { VoiceFlowStateChangedPayload } from "../types/events";
import { useSettingsStore } from "./useSettingsStore";

const SUCCESS_DISPLAY_DURATION_MS = 1000;
const ERROR_DISPLAY_DURATION_MS = 3000;
const NO_SPEECH_PROBABILITY_THRESHOLD = 0.9;
const START_SOUND_DURATION_MS = 400;

const WHISPER_HALLUCINATION_PHRASES = new Set([
  "谢谢大家",
  "謝謝大家",
  "感谢收看",
  "感謝收看",
  "Thanks for watching",
  "Thank you for watching",
  "Subtitles by",
]);

const WHISPER_HALLUCINATION_SUBSTRINGS = [
  "字幕由",
  "请不吝点赞",
  "請不吝點贊",
  "请订阅",
  "請訂閱",
  "点赞、订阅",
  "點贊、訂閱",
  "支持《明鏡》",
  "支持《點點》",
  "支持《点点》",
  "MING PAO",
  "Ming Pao",
];

// CJK Unified Ideographs range
const CJK_REGEX = /[\u4e00-\u9fff]/;

/**
 * Whisper 靜音幻覺常出現重複片段（如 "MING PAO Canada MING PAO Toronto"）。
 * 將文字切成 token，偵測任何 token 是否重複出現。
 */
function hasRepeatedTokens(text: string): boolean {
  const tokens = text
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length >= 3);
  if (tokens.length < 3) return false;
  const seen = new Set<string>();
  for (const token of tokens) {
    if (seen.has(token)) return true;
    seen.add(token);
  }
  return false;
}

function isSilenceOrHallucination(
  rawText: string,
  noSpeechProbability: number,
): boolean {
  if (!rawText) return true;
  if (noSpeechProbability >= NO_SPEECH_PROBABILITY_THRESHOLD) return true;
  if (WHISPER_HALLUCINATION_PHRASES.has(rawText)) return true;
  if (WHISPER_HALLUCINATION_SUBSTRINGS.some((sub) => rawText.includes(sub)))
    return true;
  const settingsStore = useSettingsStore();
  const whisperLang = settingsStore.getWhisperLanguageCode();
  // CJK-specific check: zh mode, no CJK chars, repeated tokens → hallucination
  if (
    whisperLang === "zh" &&
    !CJK_REGEX.test(rawText) &&
    hasRepeatedTokens(rawText)
  )
    return true;
  // Language-agnostic fallback: any mode (including auto), repeated tokens → likely hallucination
  if (whisperLang === null && hasRepeatedTokens(rawText)) return true;
  return false;
}
function t(key: string, params?: Record<string, unknown>): string {
  return i18n.global.t(key, params ?? {});
}

const MONITOR_POLL_INTERVAL_MS = 250;

export const useVoiceFlowStore = defineStore("voice-flow", () => {
  const status = ref<HudStatus>("idle");
  const message = ref("");
  const isRecording = ref<boolean>(false);
  const recordingElapsedSeconds = ref<number>(0);
  let elapsedTimer: ReturnType<typeof setInterval> | null = null;
  let cachedAppWindow: ReturnType<typeof getCurrentWindow> | null = null;
  const unlistenFunctions: UnlistenFn[] = [];
  let autoHideTimer: ReturnType<typeof setTimeout> | null = null;
  let collapseHideTimer: ReturnType<typeof setTimeout> | null = null;
  const COLLAPSE_HIDE_DELAY_MS = 400;
  const lastWasModified = ref<boolean | null>(null);
  let monitorPollTimer: ReturnType<typeof setInterval> | null = null;
  let delayedMuteTimer: ReturnType<typeof setTimeout> | null = null;
  let lastMonitorKey = "";
  let isRepositioning = false;

  function getAppWindow() {
    if (!cachedAppWindow) cachedAppWindow = getCurrentWindow();
    return cachedAppWindow;
  }

  function writeInfoLog(logMessage: string) {
    void invoke("debug_log", { level: "info", message: logMessage });
  }

  function writeErrorLog(logMessage: string) {
    void invoke("debug_log", { level: "error", message: logMessage });
  }

  function clearAutoHideTimer() {
    if (autoHideTimer) {
      clearTimeout(autoHideTimer);
      autoHideTimer = null;
    }
  }

  function clearCollapseHideTimer() {
    if (collapseHideTimer) {
      clearTimeout(collapseHideTimer);
      collapseHideTimer = null;
    }
  }

  function startElapsedTimer() {
    recordingElapsedSeconds.value = 0;
    elapsedTimer = setInterval(() => {
      recordingElapsedSeconds.value += 1;
    }, 1000);
  }

  function stopElapsedTimer() {
    if (elapsedTimer) {
      clearInterval(elapsedTimer);
      elapsedTimer = null;
    }
    recordingElapsedSeconds.value = 0;
  }

  function emitVoiceFlowStateChanged(
    nextStatus: HudStatus,
    nextMessage = "",
  ): void {
    const payload: VoiceFlowStateChangedPayload = {
      status: nextStatus,
      message: nextMessage,
    };
    void emit(VOICE_FLOW_STATE_CHANGED, payload);
  }

  async function repositionHudToCurrentMonitor() {
    if (isRepositioning) return;
    isRepositioning = true;
    try {
      const position = await invoke<HudTargetPosition>(
        "get_hud_target_position",
      );
      if (position.monitorKey !== lastMonitorKey) {
        lastMonitorKey = position.monitorKey;
        await getAppWindow().setPosition(
          new LogicalPosition(position.x, position.y),
        );
      }
    } catch {
      // 螢幕監控重定位失敗為低優先級，不 log 避免洗版
    } finally {
      isRepositioning = false;
    }
  }

  function startMonitorPolling() {
    stopMonitorPolling();
    monitorPollTimer = setInterval(() => {
      void repositionHudToCurrentMonitor();
    }, MONITOR_POLL_INTERVAL_MS);
  }

  function stopMonitorPolling() {
    if (monitorPollTimer) {
      clearInterval(monitorPollTimer);
      monitorPollTimer = null;
    }
    lastMonitorKey = "";
    isRepositioning = false;
  }

  async function showHud() {
    const window = getAppWindow();
    lastMonitorKey = "";
    await repositionHudToCurrentMonitor();
    await window.show();
    await window.setIgnoreCursorEvents(true);
    startMonitorPolling();
  }

  async function hideHud() {
    await getAppWindow().hide();
  }

  function clearDelayedMuteTimer() {
    if (delayedMuteTimer) {
      clearTimeout(delayedMuteTimer);
      delayedMuteTimer = null;
    }
  }

  async function muteSystemAudioIfEnabled() {
    const settingsStore = useSettingsStore();
    if (!settingsStore.isMuteOnRecordingEnabled) return;
    try {
      await invoke("mute_system_audio");
    } catch (err) {
      writeErrorLog(
        `useVoiceFlowStore: mute_system_audio failed (non-blocking): ${extractErrorMessage(err)}`,
      );
      captureError(err, { source: "voice-flow", step: "mute-audio" });
    }
  }

  async function restoreSystemAudio() {
    try {
      await invoke("restore_system_audio");
    } catch (err) {
      writeErrorLog(
        `useVoiceFlowStore: restore_system_audio failed: ${extractErrorMessage(err)}`,
      );
      captureError(err, { source: "voice-flow", step: "restore-audio" });
    }
  }

  function startQualityMonitorAfterPaste() {
    void invoke("start_quality_monitor").catch((err) => {
      writeErrorLog(
        `useVoiceFlowStore: start_quality_monitor failed: ${extractErrorMessage(err)}`,
      );
      captureError(err, { source: "voice-flow", step: "quality-monitor" });
    });
  }

  function saveTranscriptionRecord(record: TranscriptionRecord) {
    const historyStore = useHistoryStore();
    void historyStore.addTranscription(record).catch((err) => {
      writeErrorLog(
        `useVoiceFlowStore: addTranscription failed: ${extractErrorMessage(err)}`,
      );
      captureError(err, { source: "voice-flow", step: "save-transcription" });
    });
  }

  function buildTranscriptionRecord(params: {
    rawText: string;
    processedText: string | null;
    recordingDurationMs: number;
    transcriptionDurationMs: number;
    enhancementDurationMs: number | null;
    wasEnhanced: boolean;
  }): TranscriptionRecord {
    const settingsStore = useSettingsStore();
    return {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      rawText: params.rawText,
      processedText: params.processedText,
      recordingDurationMs: Math.round(params.recordingDurationMs),
      transcriptionDurationMs: Math.round(params.transcriptionDurationMs),
      enhancementDurationMs:
        params.enhancementDurationMs !== null
          ? Math.round(params.enhancementDurationMs)
          : null,
      charCount: (params.processedText ?? params.rawText).length,
      triggerMode: settingsStore.triggerMode,
      wasEnhanced: params.wasEnhanced,
      wasModified: null,
      createdAt: "",
    };
  }

  function transitionTo(nextStatus: HudStatus, nextMessage = "") {
    clearAutoHideTimer();
    clearCollapseHideTimer();
    status.value = nextStatus;
    message.value = nextMessage;
    emitVoiceFlowStateChanged(nextStatus, nextMessage);

    if (nextStatus === "idle") {
      stopMonitorPolling();
      collapseHideTimer = setTimeout(() => {
        hideHud().catch((err) => {
          writeErrorLog(
            `useVoiceFlowStore: hideHud failed: ${extractErrorMessage(err)}`,
          );
          captureError(err, { source: "voice-flow", step: "hideHud" });
        });
      }, COLLAPSE_HIDE_DELAY_MS);
      return;
    }

    if (
      nextStatus === "recording" ||
      nextStatus === "transcribing" ||
      nextStatus === "enhancing"
    ) {
      showHud().catch((err) => {
        writeErrorLog(
          `useVoiceFlowStore: showHud failed: ${extractErrorMessage(err)}`,
        );
        captureError(err, { source: "voice-flow", step: "showHud" });
      });
      return;
    }

    if (nextStatus === "success") {
      showHud().catch((err) => {
        writeErrorLog(
          `useVoiceFlowStore: showHud failed: ${extractErrorMessage(err)}`,
        );
        captureError(err, { source: "voice-flow", step: "showHud" });
      });
      autoHideTimer = setTimeout(() => {
        transitionTo("idle");
      }, SUCCESS_DISPLAY_DURATION_MS);
      return;
    }

    if (nextStatus === "error") {
      showHud()
        .then(async () => {
          await getAppWindow().setIgnoreCursorEvents(false);
        })
        .catch((err) => {
          writeErrorLog(
            `useVoiceFlowStore: showHud/enableCursor failed: ${extractErrorMessage(err)}`,
          );
          captureError(err, {
            source: "voice-flow",
            step: "showHud-enableCursor",
          });
        });
      autoHideTimer = setTimeout(() => {
        transitionTo("idle");
      }, ERROR_DISPLAY_DURATION_MS);
    }
  }

  function failRecordingFlow(
    errorMessage: string,
    logMessage: string,
    error?: unknown,
  ) {
    clearDelayedMuteTimer();
    restoreSystemAudio();
    isRecording.value = false;
    transitionTo("error", errorMessage);
    writeErrorLog(logMessage);
    if (error) {
      captureError(error, { userMessage: errorMessage, source: "voice-flow" });
    }
  }

  async function completePasteFlow(params: {
    text: string;
    successMessage: string;
    record: TranscriptionRecord;
    chatUsage: ChatUsageData | null;
  }) {
    try {
      await invoke("paste_text", { text: params.text });
      isRecording.value = false;
      transitionTo("success", params.successMessage);
      startQualityMonitorAfterPaste();
      saveTranscriptionRecord(params.record);
      saveApiUsageRecordList(params.record, params.chatUsage);
    } catch (pasteError) {
      isRecording.value = false;
      failRecordingFlow(
        t("voiceFlow.pasteFailed"),
        `useVoiceFlowStore: paste_text failed: ${extractErrorMessage(pasteError)}`,
        pasteError,
      );
    }
  }

  function saveApiUsageRecordList(
    record: TranscriptionRecord,
    chatUsage: ChatUsageData | null,
  ) {
    const historyStore = useHistoryStore();
    const settingsStore = useSettingsStore();
    const roundedAudioMs = record.recordingDurationMs;

    function fireAndForget(usageRecord: ApiUsageRecord) {
      historyStore
        .addApiUsage(usageRecord)
        .catch((err) =>
          writeErrorLog(
            `useVoiceFlowStore: addApiUsage(${usageRecord.apiType}) failed: ${extractErrorMessage(err)}`,
          ),
        );
    }

    fireAndForget({
      id: crypto.randomUUID(),
      transcriptionId: record.id,
      apiType: "whisper",
      model: settingsStore.selectedWhisperModelId,
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      promptTimeMs: null,
      completionTimeMs: null,
      totalTimeMs: null,
      audioDurationMs: roundedAudioMs,
      estimatedCostCeiling: calculateWhisperCostCeiling(
        roundedAudioMs,
        settingsStore.selectedWhisperModelId,
      ),
    });

    if (chatUsage) {
      fireAndForget({
        id: crypto.randomUUID(),
        transcriptionId: record.id,
        apiType: "chat",
        model: settingsStore.selectedLlmModelId,
        promptTokens: chatUsage.promptTokens,
        completionTokens: chatUsage.completionTokens,
        totalTokens: chatUsage.totalTokens,
        promptTimeMs: chatUsage.promptTimeMs,
        completionTimeMs: chatUsage.completionTimeMs,
        totalTimeMs: chatUsage.totalTimeMs,
        audioDurationMs: null,
        estimatedCostCeiling: calculateChatCostCeiling(
          chatUsage.totalTokens,
          settingsStore.selectedLlmModelId,
        ),
      });
    }
  }

  async function handleStartRecording() {
    if (isRecording.value) return;
    isRecording.value = true;
    lastWasModified.value = null;

    try {
      void invoke("play_start_sound").catch(() => {});
      delayedMuteTimer = setTimeout(() => {
        delayedMuteTimer = null;
        void muteSystemAudioIfEnabled();
      }, START_SOUND_DURATION_MS);
      await invoke("start_recording");
      startElapsedTimer();
      transitionTo("recording", t("voiceFlow.recording"));
      writeInfoLog("useVoiceFlowStore: recording started");
    } catch (error) {
      const errorMessage = getMicrophoneErrorMessage(error);
      const technicalErrorMessage = extractErrorMessage(error);
      failRecordingFlow(
        errorMessage,
        `useVoiceFlowStore: start recording failed: ${technicalErrorMessage}`,
        error,
      );
    }
  }

  async function handleStopRecording() {
    if (!isRecording.value) return;

    clearDelayedMuteTimer();
    await restoreSystemAudio();
    void invoke("play_stop_sound").catch(() => {});
    stopElapsedTimer();

    try {
      const stopResult = await invoke<StopRecordingResult>("stop_recording");
      const recordingDurationMs = stopResult.recordingDurationMs;

      const MINIMUM_RECORDING_DURATION_MS = 300;
      if (recordingDurationMs < MINIMUM_RECORDING_DURATION_MS) {
        failRecordingFlow(
          t("voiceFlow.recordingTooShort"),
          `useVoiceFlowStore: recording too short (${Math.round(recordingDurationMs)}ms)`,
        );
        return;
      }

      transitionTo("transcribing", t("voiceFlow.transcribing"));
      const settingsStore = useSettingsStore();
      let apiKey = settingsStore.getApiKey();

      if (!apiKey) {
        await settingsStore.refreshApiKey();
        apiKey = settingsStore.getApiKey();
      }

      if (!apiKey) {
        failRecordingFlow(
          t("errors.apiKeyMissing"),
          "useVoiceFlowStore: missing API key while transcribing",
        );
        return;
      }

      const vocabularyStore = useVocabularyStore();
      const vocabularyTermList = vocabularyStore.termList.map(
        (entry) => entry.term,
      );
      const hasVocabulary = vocabularyTermList.length > 0;

      const result = await invoke<TranscriptionResult>("transcribe_audio", {
        apiKey,
        vocabularyTermList: hasVocabulary ? vocabularyTermList : null,
        modelId: settingsStore.selectedWhisperModelId,
        language: settingsStore.getWhisperLanguageCode(),
      });

      writeInfoLog(`轉錄原文: "${result.rawText}"`);

      if (
        isSilenceOrHallucination(result.rawText, result.noSpeechProbability)
      ) {
        failRecordingFlow(
          t("voiceFlow.noSpeechDetected"),
          `useVoiceFlowStore: silence detected (noSpeechProb=${result.noSpeechProbability.toFixed(3)}, text="${result.rawText}")`,
        );
        return;
      }

      if (
        !settingsStore.isEnhancementThresholdEnabled ||
        result.rawText.length >= settingsStore.enhancementThresholdCharCount
      ) {
        transitionTo("enhancing", t("voiceFlow.enhancing"));
        const enhancementStartTime = performance.now();

        try {
          const enhanceResult = await enhanceText(result.rawText, apiKey, {
            systemPrompt: settingsStore.getAiPrompt(),
            vocabularyTermList:
              vocabularyTermList.length > 0 ? vocabularyTermList : undefined,
            modelId: settingsStore.selectedLlmModelId,
          });

          const enhancementDurationMs =
            performance.now() - enhancementStartTime;

          const record = buildTranscriptionRecord({
            rawText: result.rawText,
            processedText: enhanceResult.text,
            recordingDurationMs,
            transcriptionDurationMs: result.transcriptionDurationMs,
            enhancementDurationMs,
            wasEnhanced: true,
          });

          writeInfoLog(`AI 整理: "${enhanceResult.text}"`);

          await completePasteFlow({
            text: enhanceResult.text,
            successMessage: t("voiceFlow.pasteSuccess"),
            record,
            chatUsage: enhanceResult.usage,
          });

          writeInfoLog(
            `useVoiceFlowStore: pasted enhanced text, recordingDurationMs=${Math.round(
              recordingDurationMs,
            )}, transcriptionDurationMs=${Math.round(
              result.transcriptionDurationMs,
            )}, enhancementDurationMs=${Math.round(enhancementDurationMs)}`,
          );
        } catch (enhanceError) {
          const fallbackEnhancementDurationMs =
            performance.now() - enhancementStartTime;
          const enhanceErrorDetail = getEnhancementErrorMessage(enhanceError);
          writeErrorLog(
            `useVoiceFlowStore: AI enhancement failed: ${enhanceErrorDetail}`,
          );
          captureError(enhanceError, {
            source: "voice-flow",
            step: "enhancement",
          });

          const fallbackRecord = buildTranscriptionRecord({
            rawText: result.rawText,
            processedText: null,
            recordingDurationMs,
            transcriptionDurationMs: result.transcriptionDurationMs,
            enhancementDurationMs: fallbackEnhancementDurationMs,
            wasEnhanced: false,
          });

          await completePasteFlow({
            text: result.rawText,
            successMessage: t("voiceFlow.pasteSuccessUnenhanced"),
            record: fallbackRecord,
            chatUsage: null,
          });
        }
      } else {
        const record = buildTranscriptionRecord({
          rawText: result.rawText,
          processedText: null,
          recordingDurationMs,
          transcriptionDurationMs: result.transcriptionDurationMs,
          enhancementDurationMs: null,
          wasEnhanced: false,
        });

        await completePasteFlow({
          text: result.rawText,
          successMessage: t("voiceFlow.pasteSuccess"),
          record,
          chatUsage: null,
        });

        writeInfoLog(
          `useVoiceFlowStore: pasted text (skipped enhancement, length=${result.rawText.length}), recordingDurationMs=${Math.round(
            recordingDurationMs,
          )}, transcriptionDurationMs=${Math.round(result.transcriptionDurationMs)}`,
        );
      }
    } catch (error) {
      const userMessage = getTranscriptionErrorMessage(error);
      const technicalMessage = extractErrorMessage(error);
      failRecordingFlow(
        userMessage,
        `useVoiceFlowStore: stop recording failed: ${technicalMessage}`,
        error,
      );
    }
  }

  async function initialize() {
    const settingsStore = useSettingsStore();
    writeInfoLog("useVoiceFlowStore: initializing");

    await settingsStore.loadSettings();

    const listeners = await Promise.all([
      listen(HOTKEY_PRESSED, () => {
        void handleStartRecording();
      }),
      listen(HOTKEY_RELEASED, () => {
        void handleStopRecording();
      }),
      listen<HotkeyEventPayload>(HOTKEY_TOGGLED, (event) => {
        if (event.payload.action === "start") {
          void handleStartRecording();
          return;
        }

        if (event.payload.action === "stop") {
          void handleStopRecording();
        }
      }),
      listen<QualityMonitorResultPayload>(QUALITY_MONITOR_RESULT, (event) => {
        lastWasModified.value = event.payload.wasModified;
        writeInfoLog(
          `useVoiceFlowStore: quality monitor result: wasModified=${event.payload.wasModified}`,
        );
      }),
      listen<HotkeyErrorPayload>(HOTKEY_ERROR, (event) => {
        const hudMessage = getHotkeyErrorMessage(event.payload.error);
        if (
          event.payload.error === HOTKEY_ERROR_CODES.ACCESSIBILITY_PERMISSION
        ) {
          void (async () => {
            try {
              const mainWindow = await Window.getByLabel("main-window");
              if (!mainWindow) return;
              await mainWindow.show();
              await mainWindow.setFocus();
            } catch (err) {
              writeErrorLog(
                `useVoiceFlowStore: show/focus main-window failed: ${extractErrorMessage(err)}`,
              );
            }
          })();
        }
        transitionTo("error", hudMessage);
        writeErrorLog(
          `useVoiceFlowStore: hotkey error: ${event.payload.message}`,
        );
      }),
    ]);
    unlistenFunctions.push(...listeners);
  }

  function cleanup() {
    clearAutoHideTimer();
    clearCollapseHideTimer();
    clearDelayedMuteTimer();
    stopMonitorPolling();
    stopElapsedTimer();

    for (const unlisten of unlistenFunctions) {
      unlisten();
    }
    unlistenFunctions.length = 0;
  }

  return {
    status,
    message,
    recordingElapsedSeconds,
    lastWasModified,
    initialize,
    cleanup,
    transitionTo,
  };
});
