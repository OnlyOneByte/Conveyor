import { writable } from "svelte/store";
import { announce } from "../announce";

let ids = 0;
export const uid = (prefix: string) => `${prefix}-${++ids}`;

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

export const closesOn = (key: string) => key === "Escape" || key === "Tab";

export const TABBABLE = `a[href], ${["button", "input", "select", "textarea"].map((tag) => `${tag}:not(:disabled)`).join(", ")}, summary, [tabindex]:not([tabindex="-1"]), [contenteditable]:not([contenteditable="false"])`;

export function wrapTab(back: boolean, at: number, count: number): number | null {
  if (count === 0) return null;
  if (back && at <= 0) return count - 1;
  if (!back && (at === count - 1 || at === -1)) return 0;
  return null;
}

interface Toast {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
}

export const TOAST_MS = 6000;

type Hold = "focus" | "pointer";
type Timer = { after: (run: () => void, ms: number) => () => void; now: () => number };

const realTimer: Timer = { after: (run, ms) => { const handle = setTimeout(run, ms); return () => clearTimeout(handle); }, now: () => Date.now() };

export function createToasts({ after, now }: Timer = realTimer, say: (text: string) => unknown = () => {}) {
  const { subscribe, update } = writable<Toast[]>([]);
  const live = new Map<number, { left: number; since: number; holds: Set<Hold>; stop: () => void }>();
  let last = 0;
  const dismiss = (id: number) => {
    live.get(id)?.stop();
    live.delete(id);
    update((all) => all.filter((t) => t.id !== id));
  };
  const run = (id: number, left: number) => ({ since: now(), stop: after(() => dismiss(id), left) });
  const show = (text: string, action?: Toast["action"]) => {
    const id = ++last;
    update((all) => [...all, { id, text, action }]);
    live.set(id, { left: TOAST_MS, holds: new Set(), ...run(id, TOAST_MS) });
    say(text);
    return id;
  };
  const hold = (id: number, why: Hold) => {
    const toast = live.get(id);
    if (!toast || toast.holds.has(why)) return;
    if (toast.holds.size === 0) { toast.stop(); toast.left -= now() - toast.since; }
    toast.holds.add(why);
  };
  const release = (id: number, why: Hold) => {
    const toast = live.get(id);
    if (!toast?.holds.delete(why) || toast.holds.size > 0) return;
    Object.assign(toast, run(id, toast.left));
  };
  return { subscribe, show, dismiss, hold, release };
}

export const toasts = createToasts(realTimer, announce);

export function measured(node: HTMLElement, name: string) {
  const root = document.documentElement.style;
  const height = () => `${Math.ceil(node.getBoundingClientRect().height)}px`;
  const seen = new ResizeObserver(() => root.setProperty(`--${name}`, height()));
  seen.observe(node);
  return { destroy: () => (seen.disconnect(), root.removeProperty(`--${name}`)) };
}
