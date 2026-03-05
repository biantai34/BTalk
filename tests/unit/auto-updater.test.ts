import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockCheck = vi.fn();
const mockRelaunch = vi.fn();

vi.mock("@tauri-apps/plugin-updater", () => ({
  check: mockCheck,
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: mockRelaunch,
}));

describe("autoUpdater.ts", () => {
  beforeEach(() => {
    vi.resetModules();
    mockCheck.mockReset();
    mockRelaunch.mockReset();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("[P0] 無更新時應回傳 up-to-date", async () => {
    mockCheck.mockResolvedValue(null);

    const { checkForAppUpdate } = await import("../../src/lib/autoUpdater");
    const result = await checkForAppUpdate();

    expect(result).toEqual({ status: "up-to-date" });
    expect(mockCheck).toHaveBeenCalledOnce();
  });

  it("[P0] 有更新時應回傳 update-available 且不觸發下載", async () => {
    const mockDownload = vi.fn().mockResolvedValue(undefined);
    mockCheck.mockResolvedValue({
      version: "1.2.0",
      download: mockDownload,
      install: vi.fn(),
    });

    const { checkForAppUpdate } = await import("../../src/lib/autoUpdater");
    const result = await checkForAppUpdate();

    expect(result).toEqual({ status: "update-available", version: "1.2.0" });
    expect(mockDownload).not.toHaveBeenCalled();
  });

  it("[P0] check 失敗應回傳 error 結果且不拋錯", async () => {
    mockCheck.mockRejectedValue(new Error("Network error"));

    const { checkForAppUpdate } = await import("../../src/lib/autoUpdater");
    const result = await checkForAppUpdate();

    expect(result).toEqual({ status: "error", error: "Network error" });
    expect(console.error).toHaveBeenCalledWith(
      "[autoUpdater] Update check failed:",
      "Network error",
    );
  });

  it("[P0] downloadUpdate 應只下載不安裝", async () => {
    const mockDownload = vi.fn().mockResolvedValue(undefined);
    const mockInstall = vi.fn();
    mockCheck.mockResolvedValue({
      version: "1.2.0",
      download: mockDownload,
      install: mockInstall,
    });

    const { checkForAppUpdate, downloadUpdate } = await import(
      "../../src/lib/autoUpdater"
    );
    await checkForAppUpdate();
    await downloadUpdate();

    expect(mockDownload).toHaveBeenCalledOnce();
    expect(mockInstall).not.toHaveBeenCalled();
    expect(mockRelaunch).not.toHaveBeenCalled();
  });

  it("[P0] installAndRelaunch 應安裝並重啟", async () => {
    const mockDownload = vi.fn().mockResolvedValue(undefined);
    const mockInstall = vi.fn().mockResolvedValue(undefined);
    mockCheck.mockResolvedValue({
      version: "1.2.0",
      download: mockDownload,
      install: mockInstall,
    });

    const { checkForAppUpdate, downloadUpdate, installAndRelaunch } =
      await import("../../src/lib/autoUpdater");
    await checkForAppUpdate();
    await downloadUpdate();
    await installAndRelaunch();

    expect(mockInstall).toHaveBeenCalledOnce();
    expect(mockRelaunch).toHaveBeenCalledOnce();
  });

  it("[P0] downloadInstallAndRelaunch 應一鍵完成", async () => {
    const mockDownload = vi.fn().mockResolvedValue(undefined);
    const mockInstall = vi.fn().mockResolvedValue(undefined);
    mockCheck.mockResolvedValue({
      version: "1.2.0",
      download: mockDownload,
      install: mockInstall,
    });

    const { checkForAppUpdate, downloadInstallAndRelaunch } = await import(
      "../../src/lib/autoUpdater"
    );
    await checkForAppUpdate();
    await downloadInstallAndRelaunch();

    expect(mockDownload).toHaveBeenCalledOnce();
    expect(mockInstall).toHaveBeenCalledOnce();
    expect(mockRelaunch).toHaveBeenCalledOnce();
  });

  it("[P0] 無暫存更新時 downloadUpdate 應拋錯", async () => {
    mockCheck.mockResolvedValue(null);

    const { checkForAppUpdate, downloadUpdate } = await import(
      "../../src/lib/autoUpdater"
    );
    await checkForAppUpdate();

    await expect(downloadUpdate()).rejects.toThrow("No pending update");
  });

  it("[P0] 下載失敗時 downloadUpdate 應拋錯", async () => {
    const mockDownload = vi
      .fn()
      .mockRejectedValue(new Error("Download failed"));
    mockCheck.mockResolvedValue({
      version: "1.2.0",
      download: mockDownload,
      install: vi.fn(),
    });

    const { checkForAppUpdate, downloadUpdate } = await import(
      "../../src/lib/autoUpdater"
    );
    await checkForAppUpdate();

    await expect(downloadUpdate()).rejects.toThrow("Download failed");
    expect(mockRelaunch).not.toHaveBeenCalled();
  });
});
