import type { Database } from "bun:sqlite";
import { z } from "zod";

const KEY = "worker_heartbeat";

const engineState = z.enum(["ok", "missing", "stub"]);

const heartbeat = z.object({
  at: z.number(),
  engines: z.record(z.string(), engineState),
});

export type EngineState = z.infer<typeof engineState>;
export type WorkerHeartbeat = z.infer<typeof heartbeat>;

export function dbWriteWorkerHeartbeat(db: Database, beat: WorkerHeartbeat): void {
  db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(
    KEY,
    JSON.stringify(beat),
  );
}

export function dbReadWorkerHeartbeat(db: Database): WorkerHeartbeat | null {
  const row = db
    .query<{ value: string }, [string]>("SELECT value FROM meta WHERE key = ?")
    .get(KEY);
  if (!row) return null;
  try {
    const parsed = heartbeat.safeParse(JSON.parse(row.value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
