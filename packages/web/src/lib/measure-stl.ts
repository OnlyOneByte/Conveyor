import type { Size } from "./stl-size.js";

export interface MeasureWorker {
  onmessage: ((event: MessageEvent<Size | null>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: File): void;
  terminate(): void;
}

const spawnWorker = (): MeasureWorker =>
  new Worker(new URL("./stl-size.worker.ts", import.meta.url), { type: "module" });

export function measureStl(file: File, spawn = spawnWorker): Promise<Size | null> {
  return new Promise((resolve) => {
    const worker = spawn();
    const done = (size: Size | null) => {
      worker.terminate();
      resolve(size);
    };
    worker.onmessage = (event: MessageEvent<Size | null>) => done(event.data);
    worker.onerror = () => done(null);
    worker.postMessage(file);
  });
}
