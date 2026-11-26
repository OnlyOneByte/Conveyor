import { ENGINE_BINARIES, type EngineState, type WorkerBeat } from "@conveyor/shared/db";

export const WORKER_STALE_MS = 45_000;

type Up = "ok" | "down";

export interface Check {
  state: Up;
  says: string;
}

export interface EngineCheck {
  state: EngineState;
  says: string;
}

export interface WorkerCheck {
  id: string;
  state: Up;
  lastSeenSecondsAgo: number;
  says: string;
  engines: Record<string, EngineCheck>;
}

export interface HealthChecks {
  db: () => void;
  redis?: () => Promise<unknown>;
  uploads: () => Promise<unknown>;
  heartbeats: () => WorkerBeat[];
  now: number;
  onError: (check: string, err: unknown) => void;
}

export interface HealthReport {
  status: "ok" | "degraded" | "down";
  says: string;
  db: Check;
  redis?: Check;
  uploads: Check;
  workers: WorkerCheck[];
}

const SAYS = {
  db: { ok: "The job database answers.", down: "The job database didn't answer." },
  redis: { ok: "The queue answers.", down: "The queue (Redis) didn't answer." },
  uploads: {
    ok: "The uploads folder takes new files.",
    down: "The uploads folder can't take new files. It may be full or read-only.",
  },
} as const;

async function check(
  name: keyof typeof SAYS,
  run: () => unknown,
  onError: HealthChecks["onError"],
) {
  try {
    await run();
    return { state: "ok", says: SAYS[name].ok } satisfies Check;
  } catch (err) {
    onError(name, err);
    return { state: "down", says: SAYS[name].down } satisfies Check;
  }
}

export function ago(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 90) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  return minutes < 90 ? `${minutes} min` : `${Math.round(minutes / 60)} h`;
}

function engineCheck(name: string, state: EngineState): EngineCheck {
  const known = ENGINE_BINARIES.find((engine) => engine.name === name);
  const label = known?.label ?? name;
  const says = {
    ok: `${label} is installed.`,
    missing: `${label} wasn't found. Install it or set ${known?.envVar ?? "its path"}.`,
    stub: `${label} is a stand-in for tests (CONVEYOR_ENGINE_STUB=1).`,
  }[state];
  return { state, says };
}

function workerCheck(beat: WorkerBeat, now: number): WorkerCheck {
  const ageMs = Math.max(0, now - beat.at);
  const fresh = ageMs <= WORKER_STALE_MS;
  return {
    id: beat.id,
    state: fresh ? "ok" : "down",
    lastSeenSecondsAgo: Math.round(ageMs / 1000),
    says: fresh
      ? `Checked in ${ago(ageMs)} ago.`
      : `Last checked in ${ago(ageMs)} ago, so it has probably stopped.`,
    engines: Object.fromEntries(
      Object.entries(beat.engines).map(([name, state]) => [name, engineCheck(name, state)]),
    ),
  };
}

const usable = (engine: EngineCheck | undefined) =>
  engine?.state === "ok" || engine?.state === "stub";

const canWork = ({ state, engines }: WorkerCheck) =>
  state === "ok" && usable(engines.openscad) && (usable(engines.orca) || usable(engines.prusa));

function headline(report: Omit<HealthReport, "status" | "says">): [HealthReport["status"], string] {
  if (report.db.state === "down") return ["down", report.db.says];
  if (report.redis?.state === "down") return ["down", report.redis.says];
  if (!report.workers.length) return ["degraded", "No worker has checked in, so jobs won't run."];
  if (!report.workers.some(canWork))
    return ["degraded", "No running worker has a generator and a slicer, so jobs won't run."];
  const stopped = report.workers.find((worker) => worker.state === "down");
  if (stopped)
    return [
      "degraded",
      `Worker ${stopped.id} last checked in ${ago(stopped.lastSeenSecondsAgo * 1000)} ago, so it has probably stopped.`,
    ];
  if (report.uploads.state === "down") return ["degraded", report.uploads.says];
  return ["ok", "Conveyor is ready to print."];
}

export async function healthReport(checks: HealthChecks): Promise<HealthReport> {
  const db = await check("db", checks.db, checks.onError);
  const redis = checks.redis ? await check("redis", checks.redis, checks.onError) : undefined;
  const uploads = await check("uploads", checks.uploads, checks.onError);
  let beats: WorkerBeat[] = [];
  if (db.state === "ok") {
    try {
      beats = checks.heartbeats();
    } catch (err) {
      checks.onError("worker heartbeat", err);
    }
  }
  const parts = {
    db,
    ...(redis ? { redis } : {}),
    uploads,
    workers: beats.map((beat) => workerCheck(beat, checks.now)),
  };
  const [status, says] = headline(parts);
  return { status, says, ...parts };
}
