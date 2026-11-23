import { writable } from "svelte/store";

export function rememberFocus(active: () => { focus(): void } | null) {
  const opener = active();
  return () => opener?.focus();
}

export function nextIndex(key: string, current: number, count: number): number | null {
  if (count === 0) return null;
  if (key === "ArrowDown") return (current + 1) % count;
  if (key === "ArrowUp") return (current - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

export const closesOn = (key: string) => key === "Escape";

export function wrapTab(back: boolean, at: number, count: number): number | null {
  if (count === 0) return null;
  if (back && at <= 0) return count - 1;
  if (!back && (at === count - 1 || at === -1)) return 0;
  return null;
}

export interface Toast {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
}

export const TOAST_MS = 6000;

export function createToasts(after: (run: () => void, ms: number) => unknown = setTimeout) {
  const { subscribe, update } = writable<Toast[]>([]);
  let last = 0;
  const dismiss = (id: number) => update((all) => all.filter((t) => t.id !== id));
  const show = (text: string, action?: Toast["action"]) => {
    const id = ++last;
    update((all) => [...all, { id, text, action }]);
    after(() => dismiss(id), TOAST_MS);
    return id;
  };
  return { subscribe, show, dismiss };
}

export const toasts = createToasts();
