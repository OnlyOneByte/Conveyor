import type { Size } from "./stl-size.js";

export interface MeasureWorker {
  onmessage: ((event: MessageEvent<Size | null>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: File): void;
  terminate(): void;
}

const spawnWorker = (): MeasureWorker =>
  new Worker(new URL("./stl-size.worker.ts", import.meta.url), { type: "module" });

export function measureStl(
  file: File,
  signal?: AbortSignal,
  spawn = spawnWorker,
): Promise<Size | null> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve(null);
    const worker = spawn();
    const done = (size: Size | null) => {
      signal?.removeEventListener("abort", stop);
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
      resolve(size);
    };
    const stop = () => done(null);
    signal?.addEventListener("abort", stop, { once: true });
    worker.onmessage = (event: MessageEvent<Size | null>) => done(event.data);
    worker.onerror = stop;
    worker.postMessage(file);
  });
}
