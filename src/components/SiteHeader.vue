<script setup lang="ts">
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { PanelLeft } from "lucide-vue-next";

defineProps<{
  title: string;
}>();

const emit = defineEmits<{
  "toggle-sidebar": [];
}>();
</script>

<template>
  <header
    class="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-card px-4"
  >
    <Button
      variant="ghost"
      size="sm"
      class="h-8 w-8 p-0"
      @click="emit('toggle-sidebar')"
    >
      <PanelLeft class="h-[18px] w-[18px]" />
    </Button>
    <Separator orientation="vertical" class="h-5" />
    <h1 class="text-base font-semibold text-foreground">
      {{ title }}
    </h1>
  </header>
</template>
