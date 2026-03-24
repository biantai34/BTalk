# BTalk — 變態輸入法

> 紳士般的優雅口說，變態般的文字輸出能力。變態紳士就要用變態輸入法。

BTalk 是基於 [SayIt](https://github.com/chenjackle45/SayIt) 的 fork，由好倫 (biantai34) 負優化。在任何應用程式中按住快捷鍵說話，放開後語音經 Groq Whisper API 轉錄，再由 Groq LLM 自動把你的嘴砲轉成通順的繁體中文書面語，直接貼入游標位置。嘴巴動一動，文章就出來了，科科。

## 特色

- **口語到書面語** — AI 自動去除贅詞、重組句構、修正標點，說完即可用，打字什麼的太累了呵呵
- **全域快捷鍵** — 在任何應用程式中觸發，支援 Hold / Toggle 雙模式，無所不在科科
- **Option + 自訂鍵組合** — 可設定 Option (⌥) 加任意鍵作為觸發快捷鍵，組合技get
- **低延遲** — 基於 Groq 推論引擎，端到端 < 3 秒（含 AI 整理），比你反應還快呵呵
- **自訂詞彙字典** — 確保專有名詞、技術術語正確轉錄，再冷門的詞都認得出來
- **歷史記錄與統計** — 自動保存所有轉錄，Dashboard 一覽使用狀況，看看自己多能講科科

## 安裝

### 下載

| 平台 | 下載連結 |
|------|---------|
| macOS (Apple Silicon) | [BTalk-mac-arm64.dmg](https://github.com/biantai34/BTalk/releases/latest/download/BTalk-mac-arm64.dmg) |
| macOS (Intel) | [BTalk-mac-x64.dmg](https://github.com/biantai34/BTalk/releases/latest/download/BTalk-mac-x64.dmg) |
| Windows | [BTalk-windows-x64.exe](https://github.com/biantai34/BTalk/releases/latest/download/BTalk-windows-x64.exe) |

### 前置需求

- [Groq API Key](https://console.groq.com/keys)（免費申請，不用錢的最香）

### 快速開始

1. 下載並安裝
2. 開啟 BTalk → 設定頁面 → 貼上 Groq API Key
3. 在任何應用程式中按住 `Fn` 鍵說話，放開後文字自動貼上
4. 從此靠嘴吃飯，呵呵

## 致謝

原始專案 [SayIt](https://github.com/chenjackle45/SayIt) 由 [Jackle Chen](https://jackle.pro) 開發，MIT 授權。沒有他就沒有這個變態輸入法，科科。

## License

[MIT](LICENSE)
