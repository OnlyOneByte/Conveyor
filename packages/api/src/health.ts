import type { EngineState, WorkerHeartbeat } from "@conveyor/shared/db";

export const WORKER_STALE_MS = 45_000;

type Up = "ok" | "down";

export interface HealthChecks {
  db: () => void;
  redis?: () => Promise<unknown>;
  heartbeat: () => WorkerHeartbeat | null;
  now: number;
  onError: (check: string, err: unknown) => void;
}

export interface HealthReport {
  status: "ok" | "degraded" | "down";
  db: Up;
  redis?: Up;
  worker: { state: "ok" | "stale" | "missing"; lastSeenSecondsAgo?: number };
  engines: Record<string, EngineState>;
}

async function up(name: string, check: () => unknown, onError: HealthChecks["onError"]) {
  try {
    await check();
    return "ok";
  } catch (err) {
    onError(name, err);
    return "down";
  }
}

const usable = (state: EngineState | undefined) => state === "ok" || state === "stub";

export async function healthReport(checks: HealthChecks): Promise<HealthReport> {
  const db: Up = await up("db", checks.db, checks.onError);
  const redis: Up | undefined = checks.redis
    ? await up("redis", checks.redis, checks.onError)
    : undefined;
  let beat: WorkerHeartbeat | null = null;
  if (db === "ok") {
    try {
      beat = checks.heartbeat();
    } catch (err) {
      checks.onError("worker heartbeat", err);
    }
  }
  const ageMs = beat ? Math.max(0, checks.now - beat.at) : undefined;
  const worker: HealthReport["worker"] =
    ageMs === undefined
      ? { state: "missing" }
      : {
          state: ageMs > WORKER_STALE_MS ? "stale" : "ok",
          lastSeenSecondsAgo: Math.round(ageMs / 1000),
        };
  const engines = beat?.engines ?? {};
  const canWork = usable(engines.openscad) && (usable(engines.orca) || usable(engines.prusa));
  const status =
    db === "down" || redis === "down"
      ? "down"
      : worker.state !== "ok" || !canWork
        ? "degraded"
        : "ok";
  return { status, db, ...(redis ? { redis } : {}), worker, engines };
}
