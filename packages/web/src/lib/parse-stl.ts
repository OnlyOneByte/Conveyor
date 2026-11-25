export interface ParsedStl {
  position: Float32Array;
  normal: Float32Array;
  radius: number;
}

export interface ParseWorker {
  onmessage: ((event: MessageEvent<ParsedStl | null>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: File): void;
  terminate(): void;
}

const spawnWorker = (): ParseWorker =>
  new Worker(new URL("./parse-stl.worker.ts", import.meta.url), { type: "module" });

export function parseStl(
  file: File,
  signal?: AbortSignal,
  spawn = spawnWorker,
): Promise<ParsedStl | null> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve(null);
    const worker = spawn();
    const done = (parsed: ParsedStl | null) => {
      signal?.removeEventListener("abort", stop);
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
      resolve(parsed);
    };
    const stop = () => done(null);
    signal?.addEventListener("abort", stop, { once: true });
    worker.onmessage = (event: MessageEvent<ParsedStl | null>) => done(event.data);
    worker.onerror = stop;
    worker.postMessage(file);
  });
}
