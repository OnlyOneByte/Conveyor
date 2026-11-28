import { writable } from "svelte/store";
import { announce } from "../announce";

let ids = 0;
export const uid = (prefix: string) => `${prefix}-${++ids}`;

export function rememberFocus(active: () => { focus(): void } | null) {
  const opener = active();
  return () => opener?.focus();
}

const fields = (root: Element) =>
  root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
    "input:not([type=file]), select, textarea",
  );

export function fadeOut(dialog: HTMLDialogElement) {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const ghost = dialog.cloneNode(true);
  if (!(ghost instanceof HTMLDialogElement)) return;
  const { top, left, width, height } = dialog.getBoundingClientRect();
  const from = fields(dialog);
  for (const [i, el] of fields(ghost).entries()) {
    el.value = from[i]?.value ?? "";
    if ("checked" in el) el.checked = from[i]?.matches(":checked") ?? false;
  }
  for (const el of ghost.querySelectorAll("[id]")) el.removeAttribute("id");
  ghost.removeAttribute("open");
  ghost.style.cssText = `top:${top}px;left:${left}px;width:${width}px;height:${height}px`;
  const veil = document.createElement("div");
  veil.className = "veil";
  veil.inert = true;
  veil.ariaHidden = "true";
  veil.style.background = getComputedStyle(dialog, "::backdrop").backgroundColor;
  veil.append(ghost);
  document.body.append(veil);
  void Promise.allSettled(veil.getAnimations().map((a) => a.finished)).then(() => veil.remove());
}

export function nextIndex(key: string, current: number, count: number): number | null {
  if (count === 0) return null;
  if (key === "ArrowDown") return (current + 1) % count;
  if (key === "ArrowUp") return (current - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

export const focusedIndex = (
  elements: readonly unknown[],
  active: unknown = document.activeElement,
) => elements.indexOf(active);

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

export type Shown = Toast & { gone?: boolean };

export function keepLeaving(shown: Shown[], live: Toast[]): Shown[] {
  const now = new Map(live.map((toast) => [toast.id, toast]));
  const kept = shown.map((toast) => now.get(toast.id) ?? { ...toast, gone: true });
  return [...kept, ...live.filter((toast) => !shown.some((s) => s.id === toast.id))];
}

type Hold = "focus" | "pointer";
type Timer = { after: (run: () => void, ms: number) => () => void; now: () => number };

const realTimer: Timer = {
  after: (run, ms) => {
    const handle = setTimeout(run, ms);
    return () => clearTimeout(handle);
  },
  now: () => Date.now(),
};

export function createToasts(
  { after, now }: Timer = realTimer,
  say: (text: string) => unknown = () => {},
) {
  const { subscribe, update } = writable<Toast[]>([]);
  const live = new Map<
    number,
    { left: number; since: number; holds: Set<Hold>; stop: () => void }
  >();
  let last = 0;
  const dismiss = (id: number) => {
    live.get(id)?.stop();
    live.delete(id);
    update((all) => all.filter((t) => t.id !== id));
  };
  const run = (id: number, left: number) => ({
    since: now(),
    stop: after(() => dismiss(id), left),
  });
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
    if (toast.holds.size === 0) {
      toast.stop();
      toast.left -= now() - toast.since;
    }
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

type Scrollable = Pick<
  HTMLElement,
  "scrollHeight" | "clientHeight" | "setAttribute" | "removeAttribute"
>;

export function syncTabStop(node: Scrollable): void {
  if (node.scrollHeight > node.clientHeight) node.setAttribute("tabindex", "0");
  else node.removeAttribute("tabindex");
}

export function tabIfScrolls(node: HTMLElement) {
  syncTabStop(node);
  const seen = new ResizeObserver(() => syncTabStop(node));
  seen.observe(node);
  return { destroy: () => seen.disconnect() };
}

export function measured(node: HTMLElement, name: string) {
  const root = document.documentElement.style;
  const height = () => `${Math.ceil(node.getBoundingClientRect().height)}px`;
  const seen = new ResizeObserver(() => root.setProperty(`--${name}`, height()));
  seen.observe(node);
  return {
    destroy: () => {
      seen.disconnect();
      root.removeProperty(`--${name}`);
    },
  };
}
