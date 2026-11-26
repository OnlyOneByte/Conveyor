import type { Database } from "bun:sqlite";
import { z } from "zod";

const PREFIX = "worker_heartbeat:";
const LEGACY_KEY = "worker_heartbeat";

export const WORKER_FORGET_MS = 24 * 60 * 60 * 1000;

export const ENGINE_BINARIES = [
  { name: "openscad", label: "OpenSCAD", envVar: "OPENSCAD_BIN", fallback: "openscad" },
  { name: "orca", label: "OrcaSlicer", envVar: "ORCA_BIN", fallback: "orca-slicer" },
  { name: "prusa", label: "PrusaSlicer", envVar: "PRUSA_BIN", fallback: "prusa-slicer" },
] as const;

const engineState = z.enum(["ok", "missing", "stub"]);

const heartbeat = z.object({
  at: z.number(),
  engines: z.record(z.string(), engineState),
});

export type EngineState = z.infer<typeof engineState>;
export type WorkerHeartbeat = z.infer<typeof heartbeat>;
export type WorkerBeat = WorkerHeartbeat & { id: string };

export function dbWriteWorkerHeartbeat(db: Database, id: string, beat: WorkerHeartbeat): void {
  db.transaction(() => {
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(
      PREFIX + id,
      JSON.stringify(beat),
    );
    db.prepare("DELETE FROM meta WHERE key = ?").run(LEGACY_KEY);
    db.prepare(
      "DELETE FROM meta WHERE substr(key, 1, ?) = ? AND CASE WHEN json_valid(value) THEN json_extract(value, '$.at') END < ?",
    ).run(PREFIX.length, PREFIX, beat.at - WORKER_FORGET_MS);
  })();
}

export function dbForgetWorkerHeartbeat(db: Database, id: string): void {
  db.prepare("DELETE FROM meta WHERE key = ?").run(PREFIX + id);
}

const parsed = (value: string) => {
  try {
    const beat = heartbeat.safeParse(JSON.parse(value));
    return beat.success ? beat.data : null;
  } catch {
    return null;
  }
};

export function dbReadWorkerHeartbeats(db: Database, now: number): WorkerBeat[] {
  const rows = db
    .query<{ key: string; value: string }, [number, string]>(
      "SELECT key, value FROM meta WHERE substr(key, 1, ?) = ? ORDER BY key",
    )
    .all(PREFIX.length, PREFIX);
  return rows.flatMap(({ key, value }) => {
    const beat = parsed(value);
    if (!beat || beat.at < now - WORKER_FORGET_MS) return [];
    return [{ id: key.slice(PREFIX.length), ...beat }];
  });
}
