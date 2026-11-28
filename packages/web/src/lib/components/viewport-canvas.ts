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

export const NO_WEBGL = "The 3D preview needs WebGL, which this browser has turned off.";

type Probe = { getContext(kind: string): unknown };

export function hasWebGL(make: () => Probe = () => document.createElement("canvas")): boolean {
  try {
    const probe = make();
    return Boolean(probe.getContext("webgl2") ?? probe.getContext("webgl"));
  } catch {
    return false;
  }
}

export const loadViewportCanvas = memoiseImport<{ default: typeof ViewportCanvas }>(
  () => import("./ViewportCanvas.svelte"),
);
