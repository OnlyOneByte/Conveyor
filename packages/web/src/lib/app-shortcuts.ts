import { get } from "svelte/store";
import { singleKeyShortcuts } from "./preferences";
import { createShortcuts, step } from "./shortcuts";

export const shortcuts = createShortcuts({ singleKeys: () => get(singleKeyShortcuts) });

export function jobKeys(): () => void {
  const move = (by: number) => {
    const rows = [...document.querySelectorAll<HTMLAnchorElement>("a.jobid")];
    rows[step(rows.findIndex((row) => row === document.activeElement), by, rows.length)]?.focus();
  };
  const off = [shortcuts.register("j", () => move(1)), shortcuts.register("k", () => move(-1))];
  off.push(shortcuts.register("/", () => document.querySelector<HTMLInputElement>(".search")?.focus()));
  return () => {
    for (const unregister of off) unregister();
  };
}
