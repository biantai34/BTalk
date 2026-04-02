---
name: verify
description: 完整驗證 — ESLint + 型別檢查 + 單元測試 + Rust clippy + 編譯檢查。在提交前或完成功能開發後使用。
---

# 完整驗證流程

依序執行以下五個檢查，任何一步失敗就停下來修正：

## 1. ESLint 檢查
```bash
npx eslint .
```

## 2. TypeScript 型別檢查
```bash
npx vue-tsc --noEmit
```

## 3. Vitest 單元測試
```bash
pnpm test
```

## 4. Rust clippy 靜態分析
```bash
cd src-tauri && cargo clippy -- -D warnings
```

## 5. Rust 編譯檢查
```bash
cd src-tauri && cargo check
```

## 行為規則

- 五步全過才算驗證通過
- 任何一步失敗時，報告完整錯誤訊息並嘗試修正
- 修正後重新跑失敗的步驟（不需要從頭跑）
- 全部通過後回報簡潔摘要
