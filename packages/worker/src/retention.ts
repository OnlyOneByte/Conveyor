import type { Database } from "bun:sqlite";
import { lstat, readdir, rm } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { DAY_MS, retentionDays, TERMINAL_STATES } from "@conveyor/shared";

export const RETENTION_INTERVAL_MS = 60 * 60 * 1000;

const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UPLOAD_FILE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.stl$/i;

export interface LiveJobs {
  ids: Set<string>;
  uploads: Set<string>;
}

export interface RetentionDeps {
  dataDir: string;
  uploadDir: string;
  maxAgeMs: number;
  now: () => number;
  finishedBefore: (cutoff: number) => string[];
  live: () => Promise<LiveJobs>;
  log: (line: string) => void;
  remove?: (path: string) => Promise<void>;
}

const removeTree = (path: string) => rm(path, { recursive: true, force: true });

export interface Reaped {
  dirs: string[];
  uploads: string[];
}

function inside(root: string, name: string): string | undefined {
  const base = resolve(root);
  const path = resolve(base, name);
  return path.startsWith(base + sep) && !path.slice(base.length + 1).includes(sep)
    ? path
    : undefined;
}

async function plain(path: string, kind: "dir" | "file"): Promise<boolean> {
  const stat = await lstat(path).catch(() => undefined);
  if (!stat || stat.isSymbolicLink()) return false;
  return kind === "dir" ? stat.isDirectory() : stat.isFile();
}

export function liveFromParams(rows: { id: string; params: unknown }[]): LiveJobs {
  const live: LiveJobs = { ids: new Set(), uploads: new Set() };
  for (const { id, params } of rows) {
    live.ids.add(id);
    if (params && typeof params === "object" && "uploadId" in params) {
      const uploadId = params.uploadId;
      if (typeof uploadId === "string") live.uploads.add(uploadId);
    }
  }
  return live;
}

export function sqliteFinishedBefore(db: Database, cutoff: number): string[] {
  const states = TERMINAL_STATES.map(() => "?").join(", ");
  return db
    .query<{ id: string }, (string | number)[]>(
      `SELECT id FROM jobs WHERE state IN (${states}) AND updated_at < ?`,
    )
    .all(...TERMINAL_STATES, cutoff)
    .map((row) => row.id);
}

export function sqliteLive(db: Database): LiveJobs {
  const states = TERMINAL_STATES.map(() => "?").join(", ");
  const rows = db
    .query<{ id: string; params_json: string | null }, string[]>(
      `SELECT id, params_json FROM jobs WHERE state NOT IN (${states})`,
    )
    .all(...TERMINAL_STATES);
  return liveFromParams(
    rows.map((row) => {
      try {
        return { id: row.id, params: row.params_json ? JSON.parse(row.params_json) : null };
      } catch {
        return { id: row.id, params: null };
      }
    }),
  );
}

async function reapDirs(deps: RetentionDeps, cutoff: number, live: LiveJobs): Promise<string[]> {
  const reaped: string[] = [];
  for (const id of deps.finishedBefore(cutoff)) {
    if (!JOB_ID.test(id) || live.ids.has(id)) continue;
    const path = inside(deps.dataDir, id);
    if (!path || !(await plain(path, "dir"))) continue;
    await (deps.remove ?? removeTree)(path);
    reaped.push(id);
  }
  return reaped;
}

async function reapUploads(deps: RetentionDeps, cutoff: number, live: LiveJobs): Promise<string[]> {
  const names = await readdir(deps.uploadDir).catch(() => []);
  const reaped: string[] = [];
  for (const name of names) {
    const uploadId = UPLOAD_FILE.exec(name)?.[1];
    if (!uploadId || live.uploads.has(uploadId)) continue;
    const path = inside(deps.uploadDir, name);
    if (!path || !(await plain(path, "file"))) continue;
    const stat = await lstat(path);
    if (stat.mtimeMs >= cutoff) continue;
    await (deps.remove ?? removeTree)(path);
    reaped.push(uploadId);
  }
  return reaped;
}

export async function reapOnce(deps: RetentionDeps): Promise<Reaped> {
  const cutoff = deps.now() - deps.maxAgeMs;
  const live = await deps.live();
  const dirs = await reapDirs(deps, cutoff, live);
  const uploads = await reapUploads(deps, cutoff, live);
  if (dirs.length || uploads.length)
    deps.log(`[retention] removed ${dirs.length} job folders and ${uploads.length} uploads`);
  return { dirs, uploads };
}

export function startRetention(
  env: Record<string, string | undefined>,
  deps: Omit<RetentionDeps, "maxAgeMs" | "now">,
): () => void {
  const days = retentionDays(env);
  if (days === 0) return () => {};
  const run = () =>
    void reapOnce({ ...deps, maxAgeMs: days * DAY_MS, now: Date.now }).catch((err: unknown) =>
      deps.log(`[retention] skipped this run: ${err instanceof Error ? err.message : String(err)}`),
    );
  run();
  const timer = setInterval(run, RETENTION_INTERVAL_MS);
  return () => clearInterval(timer);
}
