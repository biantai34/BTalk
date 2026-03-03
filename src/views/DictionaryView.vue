<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useVocabularyStore } from "../stores/useVocabularyStore";
import { extractErrorMessage } from "../lib/errorUtils";
import { useFeedbackMessage } from "../composables/useFeedbackMessage";

const vocabularyStore = useVocabularyStore();

const newTermInput = ref("");
const isAdding = ref(false);
const removingTermIdSet = ref(new Set<string>());
const feedback = useFeedbackMessage();

const isAddDisabled = computed(
  () => !newTermInput.value.trim() || isAdding.value,
);

const showDuplicateHint = computed(
  () =>
    newTermInput.value.trim() !== "" &&
    vocabularyStore.isDuplicateTerm(newTermInput.value),
);

async function handleAddTerm() {
  const term = newTermInput.value.trim();
  if (!term) return;

  try {
    isAdding.value = true;
    await vocabularyStore.addTerm(term);
    newTermInput.value = "";
    feedback.show("success", `已新增「${term}」`);
  } catch (err) {
    feedback.show("error", extractErrorMessage(err));
  } finally {
    isAdding.value = false;
  }
}

async function handleRemoveTerm(id: string, term: string) {
  if (removingTermIdSet.value.has(id)) return;

  try {
    removingTermIdSet.value.add(id);
    await vocabularyStore.removeTerm(id);
    feedback.show("success", `已刪除「${term}」`);
  } catch (err) {
    feedback.show("error", extractErrorMessage(err));
  } finally {
    removingTermIdSet.value.delete(id);
  }
}

function formatDate(dateString: string): string {
  try {
    // SQLite created_at 儲存為 UTC 且不帶時區後綴，附加 "Z" 確保以 UTC 解析
    const date = new Date(dateString + "Z");
    return date.toLocaleDateString("zh-TW", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    return dateString;
  }
}

onMounted(async () => {
  try {
    await vocabularyStore.fetchTermList();
  } catch {
    feedback.show("error", "載入詞彙清單失敗");
  }
});

onBeforeUnmount(() => {
  feedback.clearTimer();
});
</script>

<template>
  <div class="p-6 text-white">
    <h1 class="text-2xl font-bold text-white">自訂字典</h1>
    <p class="mt-2 text-zinc-400">管理自訂詞彙以提升轉錄精準度</p>

    <section class="mt-6 rounded-xl border border-zinc-700 bg-zinc-900 p-5">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h2 class="text-lg font-semibold text-white">詞彙管理</h2>
        <span class="rounded-full bg-blue-500/20 px-2 py-0.5 text-xs font-medium text-blue-400">
          {{ vocabularyStore.termCount }} 個詞彙
        </span>
      </div>

      <div class="mt-4 flex items-start gap-2">
        <div class="flex-1">
          <input
            v-model="newTermInput"
            type="text"
            placeholder="輸入新詞彙..."
            class="w-full rounded-lg border border-zinc-600 bg-zinc-800 px-4 py-2 text-white outline-none transition focus:border-blue-500"
            @keydown.enter="handleAddTerm"
          />
          <p
            v-if="showDuplicateHint"
            class="mt-1 text-sm text-yellow-400"
          >
            此詞彙已存在
          </p>
        </div>
        <button
          type="button"
          class="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="isAddDisabled || showDuplicateHint"
          @click="handleAddTerm"
        >
          新增
        </button>
      </div>

      <transition name="feedback-fade">
        <p
          v-if="feedback.message.value !== ''"
          class="mt-3 text-sm"
          :class="feedback.type.value === 'success' ? 'text-green-400' : 'text-red-400'"
        >
          {{ feedback.message.value }}
        </p>
      </transition>

      <div v-if="vocabularyStore.isLoading" class="mt-6 text-center text-zinc-400">
        載入中...
      </div>

      <div
        v-else-if="vocabularyStore.termCount === 0"
        class="mt-6 rounded-lg border border-dashed border-zinc-600 px-4 py-8 text-center text-zinc-400"
      >
        尚無自訂詞彙，新增常用術語以提升辨識率
      </div>

      <table v-else class="mt-4 w-full text-left text-sm">
        <thead>
          <tr class="border-b border-zinc-700 text-zinc-400">
            <th class="pb-2 font-medium">詞彙</th>
            <th class="pb-2 font-medium">新增時間</th>
            <th class="pb-2 text-right font-medium">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="entry in vocabularyStore.termList"
            :key="entry.id"
            class="border-b border-zinc-800 transition hover:bg-zinc-800/50"
          >
            <td class="py-2.5 text-white">{{ entry.term }}</td>
            <td class="py-2.5 text-zinc-400">{{ formatDate(entry.createdAt) }}</td>
            <td class="py-2.5 text-right">
              <button
                type="button"
                class="rounded-lg bg-red-600/20 px-3 py-1 text-sm text-red-400 transition hover:bg-red-600/30 disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="removingTermIdSet.has(entry.id)"
                @click="handleRemoveTerm(entry.id, entry.term)"
              >
                刪除
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>

<style scoped>
.feedback-fade-enter-active,
.feedback-fade-leave-active {
  transition: opacity 180ms ease;
}

.feedback-fade-enter-from,
.feedback-fade-leave-to {
  opacity: 0;
}
</style>
