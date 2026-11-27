import { spawn } from "node:child_process";
import { createWriteStream, statSync } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { StageError } from "../context.js";
import type { Stage, StageCtx } from "../index.js";

const STDERR_TAIL_CHARS = 500;

export const ENGINE_LOG = "engine.log";
export const ENGINE_LOG_MAX_BYTES = 4 * 1024 * 1024;

export interface EngineRun {
  stderr: string;
}

interface EngineLog {
  write(text: string): void;
  close(): Promise<void>;
}

function sizeOf(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}

function openEngineLog(ctx: StageCtx, cmd: string, args: string[]): EngineLog {
  const path = join(ctx.workDir, ENGINE_LOG);
  let room = ENGINE_LOG_MAX_BYTES - sizeOf(path);
  const out = createWriteStream(path, { flags: "a" });
  out.on("error", (err) => {
    room = 0;
    ctx.log(`engine log not written, the job still runs: ${err.message}`);
  });
  const write = (text: string) => {
    if (room <= 0 || out.destroyed) return;
    const bytes = Buffer.from(text);
    if (bytes.length <= room) {
      out.write(bytes);
      room -= bytes.length;
      return;
    }
    out.write(bytes.subarray(0, room));
    out.write(`\n[engine log cut off at ${ENGINE_LOG_MAX_BYTES} bytes]\n`);
    room = 0;
  };
  write(`$ ${[cmd, ...args].join(" ")}\n`);
  let closed: Promise<void> | undefined;
  const close = () => {
    closed ??= new Promise<void>((resolve) => {
      if (out.destroyed) return resolve();
      out.end(resolve);
    });
    return closed;
  };
  return { write, close };
}

export async function runEngine(
  stage: Stage,
  cmd: string,
  args: string[],
  ctx: StageCtx,
): Promise<EngineRun> {
  try {
    return await spawnEngine(stage, cmd, args, ctx);
  } finally {
    ctx.checkLease?.();
  }
}

export const KILL_GRACE_MS = 2000;

export interface GroupKill {
  kill(pid: number, signal: "SIGTERM" | "SIGKILL"): void;
  graceMs: number;
}

const SYSTEM_KILL: GroupKill = {
  kill: (pid, signal) => process.kill(pid, signal),
  graceMs: KILL_GRACE_MS,
};

function signalGroup(pid: number, signal: "SIGTERM" | "SIGKILL", ctx: StageCtx, how: GroupKill) {
  try {
    how.kill(-pid, signal);
    return true;
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "ESRCH") return false;
    ctx.log(
      `engine process group ${pid} not sent ${signal}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
}

export function killGroup(
  pid: number | undefined,
  ctx: StageCtx,
  how: GroupKill = SYSTEM_KILL,
): void {
  if (pid === undefined || pid <= 1) return;
  if (!signalGroup(pid, "SIGTERM", ctx, how)) return;
  setTimeout(() => signalGroup(pid, "SIGKILL", ctx, how), how.graceMs);
}

function spawnEngine(stage: Stage, cmd: string, args: string[], ctx: StageCtx): Promise<EngineRun> {
  return new Promise((resolve, reject) => {
    const log = openEngineLog(ctx, cmd, args);
    const child = spawn(cmd, args, { signal: ctx.signal, detached: true });
    let stderr = "";
    let failed = false;
    child.stdout.on("data", (b) => log.write(b.toString()));
    child.stderr.on("data", (b) => {
      stderr += b.toString();
      log.write(b.toString());
    });
    child.on("error", (e) => {
      if (ctx.signal.aborted) killGroup(child.pid, ctx);
      failed = true;
      log.write(`[${e.message}]\n`);
      void log.close().then(() => reject(new StageError(stage, e.message, { cause: e })));
    });
    child.on("close", (code) => {
      if (failed) return;
      log.write(`[exited ${code}]\n`);
      void log
        .close()
        .then(() =>
          code === 0
            ? resolve({ stderr })
            : reject(
                new StageError(stage, `${cmd} exited ${code}: ${stderr.slice(-STDERR_TAIL_CHARS)}`),
              ),
        );
    });
  });
}

export async function requireOutput(
  stage: Stage,
  path: string,
  missing: string,
  stderr = "",
): Promise<void> {
  const size = await stat(path).then(
    (s) => (s.isFile() ? s.size : -1),
    () => -1,
  );
  if (size > 0) return;
  const said = stderr.trim().slice(-STDERR_TAIL_CHARS);
  const empty = size === 0 ? " (the file is empty)" : "";
  throw new StageError(stage, `${missing}${empty}${said ? `: ${said}` : ""}`);
}
