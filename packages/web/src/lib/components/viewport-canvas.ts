import type ViewportCanvas from "./ViewportCanvas.svelte";

export function memoiseImport<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () => {
    if (!pending) {
      const loading = load();
      pending = loading;
      loading.catch(() => {
        if (pending === loading) pending = undefined;
      });
    }
    return pending;
  };
}

export const loadViewportCanvas = memoiseImport<{ default: typeof ViewportCanvas }>(
  () => import("./ViewportCanvas.svelte"),
);
