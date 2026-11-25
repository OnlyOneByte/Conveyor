import { get } from "svelte/store";
import { singleKeyShortcuts } from "./preferences";
import { createShortcuts } from "./shortcuts";

export const shortcuts = createShortcuts({ singleKeys: () => get(singleKeyShortcuts) });
