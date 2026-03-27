import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'
import pluginVue from 'eslint-plugin-vue'

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
      },
    },
  },
  {
    rules: {
      // shadcn-vue 元件為單字命名
      'vue/multi-word-component-names': 'off',
      // vue-tsc strict mode 已處理 unused vars 和 undef
      '@typescript-eslint/no-unused-vars': 'off',
      'no-undef': 'off',
      // Tauri IPC 邊界有時需要 any
      '@typescript-eslint/no-explicit-any': 'warn',
      // Vue template 格式化 — 專案不使用 Prettier，保留既有風格
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/html-self-closing': 'off',
    },
  },
  {
    ignores: [
      'src/components/ui/**',
      'dist/**',
      'src-tauri/**',
    ],
  },
)
