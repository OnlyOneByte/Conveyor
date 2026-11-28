import { spawn } from "node:child_process";
import { createWriteStream, statSync } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { StageError } from "../context.js";
import type { Stage, StageCtx } from "../index.js";

const STDERR_TAIL_CHARS = 500;
const STDERR_KEEP_CHARS = 2048;

function lastCodePoints(text: string, count: number): string {
  return Array.from(text.slice(-2 * count))
    .slice(-count)
    .join("");
}

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
  kill(pid: number, signal: "SIGTERM" | "SIGKILL" | 0): void;
  graceMs: number;
}

const SYSTEM_KILL: GroupKill = {
  kill: (pid, signal) => process.kill(pid, signal),
  graceMs: KILL_GRACE_MS,
};

const isGone = (err: unknown) => err instanceof Error && "code" in err && err.code === "ESRCH";

function groupIsEmpty(pid: number, how: GroupKill): boolean {
  try {
    how.kill(-pid, 0);
    return false;
  } catch (err) {
    return isGone(err);
  }
}

function signalGroup(pid: number, signal: "SIGTERM" | "SIGKILL", ctx: StageCtx, how: GroupKill) {
  try {
    how.kill(-pid, signal);
    return true;
  } catch (err) {
    if (isGone(err)) return false;
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
): () => void {
  if (pid === undefined || pid <= 1) return () => {};
  if (!signalGroup(pid, "SIGTERM", ctx, how)) return () => {};
  let cancel = () => {};
  const sent = new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      signalGroup(pid, "SIGKILL", ctx, how);
      resolve();
    }, how.graceMs);
    cancel = () => {
      clearTimeout(timer);
      resolve();
    };
  });
  pendingKills.add(sent);
  void sent.then(() => pendingKills.delete(sent));
  return () => {
    if (groupIsEmpty(pid, how)) cancel();
  };
}

const pendingKills = new Set<Promise<void>>();

export async function settleGroupKills(boundMs = KILL_GRACE_MS): Promise<void> {
  if (pendingKills.size === 0) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const bound = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, boundMs);
  });
  await Promise.race([Promise.all(pendingKills), bound]);
  clearTimeout(timer);
}

function spawnEngine(stage: Stage, cmd: string, args: string[], ctx: StageCtx): Promise<EngineRun> {
  return new Promise((resolve, reject) => {
    const log = openEngineLog(ctx, cmd, args);
    const child = spawn(cmd, args, { signal: ctx.signal, detached: true });
    const outText = new StringDecoder("utf8");
    const errText = new StringDecoder("utf8");
    let stderr = "";
    let failed = false;
    let dropKillIfGone = () => {};
    const keepStderr = (text: string) => {
      stderr = lastCodePoints(stderr + text, STDERR_KEEP_CHARS);
      log.write(text);
    };
    child.stdout.on("data", (b: Buffer) => log.write(outText.write(b)));
    child.stderr.on("data", (b: Buffer) => keepStderr(errText.write(b)));
    child.on("error", (e) => {
      if (ctx.signal.aborted) dropKillIfGone = killGroup(child.pid, ctx);
      failed = true;
      log.write(`[${e.message}]\n`);
      void log.close().then(() => reject(new StageError(stage, e.message, { cause: e })));
    });
    child.on("close", (code, signal) => {
      dropKillIfGone();
      if (failed) return;
      log.write(outText.end());
      keepStderr(errText.end());
      const how = code === null ? `killed by ${signal}` : `exited ${code}`;
      log.write(`[${how}]\n`);
      const tail = lastCodePoints(stderr, STDERR_TAIL_CHARS);
      const said = tail.trim() ? tail : `nothing on stderr, see ${ENGINE_LOG}`;
      void log
        .close()
        .then(() =>
          code === 0
            ? resolve({ stderr })
            : reject(new StageError(stage, `${cmd} ${how}: ${said}`)),
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
  const said = lastCodePoints(stderr.trim(), STDERR_TAIL_CHARS);
  const empty = size === 0 ? " (the file is empty)" : "";
  throw new StageError(stage, `${missing}${empty}${said ? `: ${said}` : ""}`);
}
