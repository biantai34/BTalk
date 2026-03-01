import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ref, readonly } from "vue";
import type { HudState } from "../../src/types";
import { API_KEY_MISSING_ERROR } from "../../src/lib/errorUtils";

// ---------------------------------------------------------------------------
// vi.hoisted: declare mock references in the hoisted scope so vi.mock
// factories can reference them without "cannot access before initialization"
// ---------------------------------------------------------------------------
const {
  mockListen,
  mockEmit,
  mockInvoke,
  mockInitializeMicrophone,
  mockStartRecording,
  mockStopRecording,
  mockTranscribeAudio,
  mockLoadSettings,
  mockSettingsState,
  mockTransitionTo,
  mockHudState,
  listenCallbackMap,
} = vi.hoisted(() => {
  type EventCallback = (event: { payload: unknown }) => void;
  const listenCallbackMap = new Map<string, EventCallback>();

  return {
    mockListen: vi.fn(async (eventName: string, callback: EventCallback) => {
      listenCallbackMap.set(eventName, callback);
      return vi.fn();
    }),
    mockEmit: vi.fn().mockResolvedValue(undefined),
    mockInvoke: vi.fn().mockResolvedValue(undefined),
    mockInitializeMicrophone: vi.fn().mockResolvedValue(undefined),
    mockStartRecording: vi.fn(),
    mockStopRecording: vi
      .fn()
      .mockResolvedValue(new Blob(["audio"], { type: "audio/webm" })),
    mockTranscribeAudio: vi
      .fn()
      .mockResolvedValue({ text: "Hello", duration: 500 }),
    mockLoadSettings: vi.fn().mockResolvedValue(undefined),
    mockSettingsState: { apiKey: "test-api-key-123" },
    mockTransitionTo: vi.fn(),
    mockHudState: { value: { status: "idle" as string, message: "" } },
    listenCallbackMap,
  };
});

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@tauri-apps/api/event", () => ({
  listen: mockListen,
  emit: mockEmit,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockInvoke,
}));

vi.mock("../../src/lib/recorder", () => ({
  initializeMicrophone: mockInitializeMicrophone,
  startRecording: mockStartRecording,
  stopRecording: mockStopRecording,
}));

vi.mock("../../src/lib/transcriber", () => ({
  transcribeAudio: mockTranscribeAudio,
}));

vi.mock("../../src/composables/useHudState", () => ({
  useHudState: () => {
    const stateRef = ref<HudState>(mockHudState.value as HudState);
    return {
      state: readonly(stateRef),
      transitionTo: mockTransitionTo,
    };
  },
}));

vi.mock("../../src/stores/useSettingsStore", () => ({
  useSettingsStore: () => ({
    loadSettings: mockLoadSettings,
    getApiKey() {
      return mockSettingsState.apiKey;
    },
    get hasApiKey() {
      return mockSettingsState.apiKey !== "";
    },
  }),
}));

// ---------------------------------------------------------------------------
// Helper: simulate event from Tauri
// ---------------------------------------------------------------------------
type EventCallback = (event: { payload: unknown }) => void;

function simulateEvent(eventName: string, payload: unknown = null) {
  const callback = listenCallbackMap.get(eventName);
  if (!callback) throw new Error(`No listener registered for "${eventName}"`);
  callback({ payload });
}

// ---------------------------------------------------------------------------
// SUT
// ---------------------------------------------------------------------------
import { useVoiceFlow } from "../../src/composables/useVoiceFlow";

describe("useVoiceFlow", () => {
  beforeEach(() => {
    listenCallbackMap.clear();
    mockInitializeMicrophone.mockClear().mockResolvedValue(undefined);
    mockStartRecording.mockClear();
    mockStopRecording
      .mockClear()
      .mockResolvedValue(new Blob(["audio"], { type: "audio/webm" }));
    mockTranscribeAudio
      .mockClear()
      .mockResolvedValue({ text: "Hello", duration: 500 });
    mockLoadSettings.mockClear().mockResolvedValue(undefined);
    mockSettingsState.apiKey = "test-api-key-123";
    mockTransitionTo.mockClear();
    mockEmit.mockClear().mockResolvedValue(undefined);
    mockInvoke.mockClear().mockResolvedValue(undefined);
    mockListen.mockClear();
    // Re-register the mock implementation so it actually stores callbacks
    mockListen.mockImplementation(
      async (eventName: string, callback: EventCallback) => {
        listenCallbackMap.set(eventName, callback);
        return vi.fn();
      },
    );
    mockHudState.value = { status: "idle", message: "" };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ========================================================================
  // initialize()
  // ========================================================================

  describe("initialize()", () => {
    it("[P0] should call initializeMicrophone on initialize", async () => {
      // Given: a fresh voice flow
      const { initialize } = useVoiceFlow();

      // When: initializing
      await initialize();

      // Then: microphone should be initialized
      expect(mockInitializeMicrophone).toHaveBeenCalledTimes(1);
    });

    it("[P0] should register hotkey event listeners", async () => {
      // Given: a fresh voice flow
      const { initialize } = useVoiceFlow();

      // When: initializing
      await initialize();

      // Then: both event listeners should be registered
      expect(mockListen).toHaveBeenCalledWith(
        "hotkey:pressed",
        expect.any(Function),
      );
      expect(mockListen).toHaveBeenCalledWith(
        "hotkey:released",
        expect.any(Function),
      );
      expect(mockListen).toHaveBeenCalledWith(
        "hotkey:toggled",
        expect.any(Function),
      );
      expect(mockListen).toHaveBeenCalledWith(
        "hotkey:error",
        expect.any(Function),
      );
      expect(listenCallbackMap.has("hotkey:pressed")).toBe(true);
      expect(listenCallbackMap.has("hotkey:released")).toBe(true);
    });

    it("[P0] should not throw if microphone initialization fails", async () => {
      // Given: microphone init will fail
      mockInitializeMicrophone.mockRejectedValueOnce(
        new Error("Permission denied"),
      );

      const { initialize } = useVoiceFlow();

      // When/Then: initialize should not throw (error is caught internally)
      await expect(initialize()).resolves.not.toThrow();
    });

    it("[P0] should log microphone init failure via invoke debug_log", async () => {
      // Given: microphone init will fail
      mockInitializeMicrophone.mockRejectedValueOnce(
        new Error("Permission denied"),
      );

      const { initialize } = useVoiceFlow();

      // When: initializing
      await initialize();

      // Then: error should be logged
      expect(mockInvoke).toHaveBeenCalledWith("debug_log", {
        level: "error",
        message: expect.stringContaining("Permission denied"),
      });
    });
  });

  // ========================================================================
  // handleStartRecording (via hotkey:pressed event)
  // ========================================================================

  describe("handleStartRecording (hotkey:pressed event)", () => {
    it("[P0] should start recording on hotkey:pressed", async () => {
      // Given: initialized voice flow
      const { initialize } = useVoiceFlow();
      await initialize();

      // When: hotkey:pressed fires
      simulateEvent("hotkey:pressed");

      // Allow microtasks to settle
      await vi.waitFor(() => {
        expect(mockStartRecording).toHaveBeenCalledTimes(1);
      });

      // Then: should initialize mic again (guard), transition, and start recording
      expect(mockInitializeMicrophone).toHaveBeenCalledTimes(2); // once in init, once in handleStartRecording
      expect(mockTransitionTo).toHaveBeenCalledWith(
        "recording",
        "Recording...",
      );
    });

    it("[P0] should not start a second recording if already recording", async () => {
      // Given: initialized voice flow, first hotkey:pressed already processed
      const { initialize } = useVoiceFlow();
      await initialize();

      simulateEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockStartRecording).toHaveBeenCalledTimes(1);
      });

      // When: another hotkey:pressed fires (e.g., key repeat)
      simulateEvent("hotkey:pressed");

      // Allow time for potential processing
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Then: startRecording should still only have been called once
      expect(mockStartRecording).toHaveBeenCalledTimes(1);
    });

    it("[P0] should transition to error if startRecording throws", async () => {
      // Given: startRecording will throw
      mockStartRecording.mockImplementationOnce(() => {
        throw new Error("Microphone not initialized");
      });

      const { initialize } = useVoiceFlow();
      await initialize();

      // When: hotkey:pressed fires
      simulateEvent("hotkey:pressed");

      await vi.waitFor(() => {
        expect(mockTransitionTo).toHaveBeenCalledWith(
          "error",
          "Microphone not initialized",
        );
      });
    });

    it("[P0] should reset isRecording flag when recording start fails", async () => {
      // Given: first recording attempt fails
      mockStartRecording.mockImplementationOnce(() => {
        throw new Error("Failed");
      });

      const { initialize } = useVoiceFlow();
      await initialize();

      simulateEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockTransitionTo).toHaveBeenCalledWith("error", "Failed");
      });

      // When: trying again (should not be blocked by isRecording = true)
      mockStartRecording.mockClear();
      mockTransitionTo.mockClear();
      mockInitializeMicrophone.mockClear().mockResolvedValue(undefined);
      simulateEvent("hotkey:pressed");

      await vi.waitFor(() => {
        expect(mockStartRecording).toHaveBeenCalledTimes(1);
      });
    });
  });

  // ========================================================================
  // handleStopRecording (via hotkey:released event)
  // ========================================================================

  describe("handleStopRecording (hotkey:released event)", () => {
    it("[P0] should do nothing if not currently recording", async () => {
      // Given: initialized but not recording
      const { initialize } = useVoiceFlow();
      await initialize();

      // When: hotkey:released fires without a prior hotkey:pressed
      simulateEvent("hotkey:released");
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Then: no transitions or stop calls
      expect(mockStopRecording).not.toHaveBeenCalled();
      expect(mockTransitionTo).not.toHaveBeenCalled();
    });

    it("[P0] should stop recording, transcribe, and paste on hotkey:released", async () => {
      // Given: currently recording
      const { initialize } = useVoiceFlow();
      await initialize();

      simulateEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockStartRecording).toHaveBeenCalled();
      });

      mockTransitionTo.mockClear();

      // When: hotkey:released fires
      simulateEvent("hotkey:released");

      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("paste_text", {
          text: "Hello",
        });
      });

      // Then: full flow should execute
      expect(mockTransitionTo).toHaveBeenCalledWith(
        "transcribing",
        "Transcribing...",
      );
      expect(mockStopRecording).toHaveBeenCalled();
      expect(mockTranscribeAudio).toHaveBeenCalledWith(
        expect.any(Blob),
        "test-api-key-123",
      );
      expect(mockTransitionTo).toHaveBeenCalledWith("idle");
      expect(mockTransitionTo).toHaveBeenCalledWith("success", "Pasted!");
    });

    it("[P0] should transition to error when transcription returns empty text", async () => {
      // Given: transcriber returns empty text
      mockTranscribeAudio.mockResolvedValueOnce({ text: "", duration: 300 });

      const { initialize } = useVoiceFlow();
      await initialize();

      simulateEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockStartRecording).toHaveBeenCalled();
      });

      mockTransitionTo.mockClear();

      // When: hotkey:released fires
      simulateEvent("hotkey:released");

      await vi.waitFor(() => {
        expect(mockTransitionTo).toHaveBeenCalledWith(
          "error",
          "No speech detected",
        );
      });

      // Then: paste_text should NOT be invoked
      expect(mockInvoke).not.toHaveBeenCalledWith(
        "paste_text",
        expect.anything(),
      );
    });

    it("[P0] should transition to error when stopRecording fails", async () => {
      // Given: stopRecording will reject
      mockStopRecording.mockRejectedValueOnce(new Error("Stop failed"));

      const { initialize } = useVoiceFlow();
      await initialize();

      simulateEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockStartRecording).toHaveBeenCalled();
      });

      mockTransitionTo.mockClear();

      // When: hotkey:released fires
      simulateEvent("hotkey:released");

      await vi.waitFor(() => {
        expect(mockTransitionTo).toHaveBeenCalledWith("error", "Stop failed");
      });
    });

    it("[P0] should transition to error when transcribeAudio fails", async () => {
      // Given: transcriber will reject
      mockTranscribeAudio.mockRejectedValueOnce(
        new Error("Groq API error (401)"),
      );

      const { initialize } = useVoiceFlow();
      await initialize();

      simulateEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockStartRecording).toHaveBeenCalled();
      });

      mockTransitionTo.mockClear();

      // When: hotkey:released fires
      simulateEvent("hotkey:released");

      await vi.waitFor(() => {
        expect(mockTransitionTo).toHaveBeenCalledWith(
          "error",
          "Groq API error (401)",
        );
      });
    });

    it("[P0] should transition to error when paste_text invoke fails", async () => {
      // Given: paste invoke will reject
      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === "paste_text")
          return Promise.reject(new Error("Paste failed"));
        return Promise.resolve(undefined);
      });

      const { initialize } = useVoiceFlow();
      await initialize();

      simulateEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockStartRecording).toHaveBeenCalled();
      });

      mockTransitionTo.mockClear();

      // When: hotkey:released fires
      simulateEvent("hotkey:released");

      await vi.waitFor(() => {
        expect(mockTransitionTo).toHaveBeenCalledWith("error", "Paste failed");
      });
    });

    it("[P0] should transition to idle before paste to let target app regain focus", async () => {
      // Given: recording is active
      const transitionCallOrder: string[] = [];
      mockTransitionTo.mockImplementation((status: string) => {
        transitionCallOrder.push(status);
      });

      const { initialize } = useVoiceFlow();
      await initialize();

      simulateEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockStartRecording).toHaveBeenCalled();
      });

      transitionCallOrder.length = 0;

      // When: hotkey:released fires and flow completes
      simulateEvent("hotkey:released");

      await vi.waitFor(() => {
        expect(mockInvoke).toHaveBeenCalledWith("paste_text", {
          text: "Hello",
        });
      });

      // Then: idle should come before success (idle hides HUD so target app gets focus)
      const idleIndex = transitionCallOrder.indexOf("idle");
      const successIndex = transitionCallOrder.indexOf("success");
      expect(idleIndex).toBeLessThan(successIndex);
      expect(idleIndex).toBeGreaterThanOrEqual(0);
    });

    it("[P0] should emit state-changed error and stop when API key is missing", async () => {
      const { initialize } = useVoiceFlow();
      await initialize();

      simulateEvent("hotkey:pressed");
      await vi.waitFor(() => {
        expect(mockStartRecording).toHaveBeenCalled();
      });

      // Simulate missing API key after recording started
      mockSettingsState.apiKey = "";
      mockTransitionTo.mockClear();
      mockTranscribeAudio.mockClear();

      simulateEvent("hotkey:released");

      await vi.waitFor(() => {
        expect(mockTransitionTo).toHaveBeenCalledWith(
          "error",
          API_KEY_MISSING_ERROR,
        );
      });

      expect(mockEmit).toHaveBeenCalledWith("voice-flow:state-changed", {
        status: "error",
        message: API_KEY_MISSING_ERROR,
      });
      expect(mockTranscribeAudio).not.toHaveBeenCalled();
    });
  });

  // ========================================================================
  // Return shape
  // ========================================================================

  describe("return value", () => {
    it("[P0] should return state and initialize function", () => {
      // Given/When: creating voice flow
      const result = useVoiceFlow();

      // Then: should expose state and initialize
      expect(result.state).toBeDefined();
      expect(typeof result.initialize).toBe("function");
    });
  });
});
