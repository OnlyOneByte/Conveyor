export type QueueMode = "redis" | "sqlite";

export function queueMode(env: Record<string, string | undefined>): QueueMode {
  const mode = env.CONVEYOR_QUEUE || "redis";
  if (mode === "redis") return mode;
  if (mode !== "sqlite") throw new Error(`CONVEYOR_QUEUE must be redis or sqlite, got ${mode}`);
  if (env.CONVEYOR_QUEUE_UNSTABLE !== "1") {
    throw new Error(
      "CONVEYOR_QUEUE=sqlite is still experimental; set CONVEYOR_QUEUE_UNSTABLE=1 to run it anyway",
    );
  }
  return mode;
}
