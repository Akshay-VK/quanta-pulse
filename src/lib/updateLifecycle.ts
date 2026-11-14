import { api } from "./api";

export class UpdateRelaunchError extends Error {
  constructor(cause: unknown) {
    super(`Update installed, but the app could not restart. Close and reopen Quanta Pulse. ${String(cause)}`);
    this.name = "UpdateRelaunchError";
  }
}

/** Run the user-approved install sequence. A failed step rejects before relaunch. */
export async function installAvailableUpdate(): Promise<boolean> {
  const update = await api.checkUpdate();
  if (!update) return false;

  try {
    await api.prepareForUpdate();
    await api.downloadAndInstallUpdate(update, () => {});
  } finally {
    // The plugin holds the update handle until it is explicitly released.
    try { await update.close?.(); } catch { /* the installer may already be exiting */ }
  }
  // Windows exits as part of its installer. Other desktop platforms need the
  // explicit relaunch once installation has completed successfully.
  if (!navigator.platform.toLowerCase().includes("win")) {
    try {
      await api.relaunchApp();
    } catch (error) {
      throw new UpdateRelaunchError(error);
    }
  }
  return true;
}
