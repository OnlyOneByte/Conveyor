export type QueueMode = "redis" | "sqlite";

export function queueMode(env: Record<string, string | undefined>): QueueMode {
  const mode = env.CONVEYOR_QUEUE || "redis";
  if (mode === "redis") return mode;
  if (mode !== "sqlite") throw new Error(`CONVEYOR_QUEUE must be redis or sqlite, got ${mode}`);
  if (env.CONVEYOR_QUEUE_UNSTABLE !== "1") {
    throw new Error(
      "CONVEYOR_QUEUE=sqlite is not ready, because the api does not enqueue to it yet; set CONVEYOR_QUEUE_UNSTABLE=1 to run it anyway",
    );
  }
  return mode;
}

export function workerConcurrency(env: Record<string, string | undefined>): number {
  const raw = env.WORKER_CONCURRENCY;
  if (raw === undefined || raw === "") return 2;
  if (!/^[1-9][0-9]*$/.test(raw)) {
    throw new Error(`WORKER_CONCURRENCY must be a positive integer, got ${raw}`);
  }
  return Number(raw);
}
