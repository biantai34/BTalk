import { ref } from "vue";

type FeedbackType = "success" | "error" | "";

const FEEDBACK_DISPLAY_DURATION_MS = 2500;

export function useFeedbackMessage() {
  const message = ref("");
  const type = ref<FeedbackType>("");
  let timer: ReturnType<typeof setTimeout> | null = null;

  function clearTimer() {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
  }

  function show(feedbackType: "success" | "error", feedbackMessage: string) {
    clearTimer();
    type.value = feedbackType;
    message.value = feedbackMessage;
    timer = setTimeout(() => {
      message.value = "";
      type.value = "";
    }, FEEDBACK_DISPLAY_DURATION_MS);
  }

  return { message, type, show, clearTimer };
}
