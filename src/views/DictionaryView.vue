<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useVocabularyStore } from "../stores/useVocabularyStore";
import { extractErrorMessage } from "../lib/errorUtils";
import { useFeedbackMessage } from "../composables/useFeedbackMessage";
import { Plus, Trash2 } from "lucide-vue-next";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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
  <div class="p-6">
    <!-- Page header -->
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div class="flex flex-col gap-1">
        <div class="flex items-center gap-3">
          <h2 class="text-xl font-semibold text-foreground">自訂字典</h2>
          <Badge variant="secondary">{{ vocabularyStore.termCount }} 詞彙</Badge>
        </div>
        <p class="text-sm text-muted-foreground">管理自訂詞彙以提升轉錄精準度</p>
      </div>

      <div class="flex items-center gap-2">
        <div class="flex flex-col">
          <Input
            v-model="newTermInput"
            placeholder="輸入新詞彙..."
            class="w-48"
            @keydown.enter="handleAddTerm"
          />
          <p v-if="showDuplicateHint" class="mt-1 text-xs text-destructive">
            此詞彙已存在
          </p>
        </div>
        <Button
          size="sm"
          :disabled="isAddDisabled || showDuplicateHint"
          @click="handleAddTerm"
        >
          <Plus class="h-4 w-4 mr-1" />新增
        </Button>
      </div>
    </div>

    <!-- Feedback message -->
    <transition name="feedback-fade">
      <p
        v-if="feedback.message.value !== ''"
        class="mt-3 text-sm"
        :class="feedback.type.value === 'success' ? 'text-emerald-500' : 'text-destructive'"
      >
        {{ feedback.message.value }}
      </p>
    </transition>

    <!-- Loading state -->
    <div v-if="vocabularyStore.isLoading" class="mt-6 text-center text-muted-foreground">
      載入中...
    </div>

    <!-- Empty state -->
    <Card v-else-if="vocabularyStore.termCount === 0" class="mt-6">
      <div class="px-4 py-8 text-center text-muted-foreground">
        尚無自訂詞彙，新增常用術語以提升辨識率
      </div>
    </Card>

    <!-- Dictionary table -->
    <Card v-else class="mt-6">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead class="w-full">詞彙</TableHead>
            <TableHead class="w-40">新增時間</TableHead>
            <TableHead class="w-20 text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow v-for="entry in vocabularyStore.termList" :key="entry.id">
            <TableCell class="font-medium text-foreground">{{ entry.term }}</TableCell>
            <TableCell class="text-muted-foreground">{{ formatDate(entry.createdAt) }}</TableCell>
            <TableCell class="text-right">
              <Button
                variant="ghost"
                size="icon-sm"
                class="text-destructive"
                :disabled="removingTermIdSet.has(entry.id)"
                @click="handleRemoveTerm(entry.id, entry.term)"
              >
                <Trash2 class="h-4 w-4" />
              </Button>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </Card>
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
