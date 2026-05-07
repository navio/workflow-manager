export const FIRST_RUN_DISMISSED_KEY = "wm_first_run_dismissed";

export function readFirstRunDismissed(storage: Pick<Storage, "getItem">): boolean {
  return storage.getItem(FIRST_RUN_DISMISSED_KEY) === "1";
}

export function writeFirstRunDismissed(storage: Pick<Storage, "setItem" | "removeItem">, dismissed: boolean): void {
  if (dismissed) {
    storage.setItem(FIRST_RUN_DISMISSED_KEY, "1");
    return;
  }

  storage.removeItem(FIRST_RUN_DISMISSED_KEY);
}
