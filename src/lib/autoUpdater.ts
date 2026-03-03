import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

/**
 * 背景檢查 App 更新，下載完成後提示使用者重啟。
 * 全程靜默錯誤處理，不影響 App 正常使用。
 */
export async function checkForAppUpdate(): Promise<void> {
  try {
    const update = await check();
    if (!update) {
      console.log("[autoUpdater] No update available");
      return;
    }

    console.log(`[autoUpdater] Update available: v${update.version}`);

    await update.download();
    console.log("[autoUpdater] Update downloaded");

    const shouldRestart = window.confirm(
      `SayIt v${update.version} 已下載完成。\n重啟以安裝更新？`,
    );

    if (shouldRestart) {
      await update.install();
      await relaunch();
    }
  } catch (err) {
    // 靜默失敗：endpoint 不可用、網路問題、簽名驗證失敗
    console.error("[autoUpdater] Update check failed (silenced):", err);
  }
}
