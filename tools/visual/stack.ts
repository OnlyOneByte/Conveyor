import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "bun";
import { messageOf } from "./errors.ts";
import { seedHistory } from "./seed.ts";
import {
  type ChildHandle,
  createTeardown,
  type ExitEvents,
  type StackHandles,
  tearDownOnExit,
} from "./teardown.ts";

export interface Stack {
  url: string;
  stop: () => Promise<void>;
}

type Log = (line: string) => void;

export interface StackChild extends ChildHandle {
  pid: number;
  exitCode: number | null;
  exited: Promise<number>;
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
}

export interface StackDeps {
  spawn: (options: {
    cmd: string[];
    cwd: string;
    env: Record<string, string | undefined>;
  }) => StackChild;
  spawnSync: (cmd: string[]) => { exitCode: number | null; stdout: Buffer; stderr: Buffer };
  events: ExitEvents;
  exit: (code: number) => void;
  sleep: (ms: number) => Promise<void>;
  seed: (root: string, env: Record<string, string | undefined>) => Promise<void>;
}

const KILL_AFTER_MS = 5000;

const defaultDeps: StackDeps = {
  spawn: (options) => spawn({ ...options, stdin: "ignore", stdout: "pipe", stderr: "pipe" }),
  spawnSync: (cmd) => Bun.spawnSync(cmd),
  events: process,
  exit: (code) => process.exit(code),
  sleep: (ms) => Bun.sleep(ms),
  seed: seedHistory,
};

async function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const srv = createServer();
    srv.once("error", fail);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => done(port));
    });
  });
}

async function waitHttp(
  url: string,
  timeoutMs: number,
  proc: { exitCode: number | null },
): Promise<void> {
  const until = Date.now() + timeoutMs;
  let last = "no response yet";
  while (Date.now() < until) {
    if (proc.exitCode !== null) throw new Error(`process for ${url} exited with ${proc.exitCode}`);
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
      last = `HTTP ${res.status}`;
    } catch (err) {
      last = messageOf(err);
    }
    await Bun.sleep(300);
  }
  throw new Error(`timed out waiting for ${url} (last: ${last})`);
}

export function redisContainer(port: number): { url: string; dockerRun: string[] } {
  return {
    url: `redis://127.0.0.1:${port}`,
    dockerRun: ["docker", "run", "-d", "--rm", "-p", `127.0.0.1:${port}:6379`, "redis:8-alpine"],
  };
}

async function startRedis(
  deps: StackDeps,
  handles: StackHandles,
  leftovers: string[],
): Promise<string> {
  const container = redisContainer(await freePort());
  const run = deps.spawnSync(container.dockerRun);
  if (run.exitCode !== 0) throw new Error(`docker run redis failed: ${run.stderr.toString()}`);
  const id = run.stdout.toString().trim();
  leftovers.push(`Redis container ${id} (remove it with: docker rm -f ${id})`);
  handles.cleanups.push(async () => {
    const removed = deps.spawnSync(["docker", "rm", "-f", id]);
    if (removed.exitCode !== 0)
      throw new Error(`docker rm -f ${id} failed: ${removed.stderr.toString().trim()}`);
  });
  const until = Date.now() + 30000;
  let ready = false;
  while (!ready && Date.now() < until) {
    ready = deps
      .spawnSync(["docker", "exec", id, "redis-cli", "ping"])
      .stdout.toString()
      .includes("PONG");
    if (!ready) await Bun.sleep(300);
  }
  if (!ready) throw new Error("redis did not answer PING within 30 s");
  return container.url;
}

async function pipeLines(
  name: string,
  stream: ReadableStream<Uint8Array>,
  log: Log,
): Promise<void> {
  const decoder = new TextDecoder();
  for await (const chunk of stream) {
    for (const line of decoder.decode(chunk).split("\n")) if (line.trim()) log(`[${name}] ${line}`);
  }
}

export function stackEnv(
  base: Record<string, string | undefined>,
  opts: { root: string; redisUrl: string; dataDir: string; apiPort: number },
): Record<string, string | undefined> {
  return {
    ...base,
    CONVEYOR_ENGINE_STUB: "1",
    CONVEYOR_AUTH: "disabled",
    CONVEYOR_HOST: "127.0.0.1",
    REDIS_URL: opts.redisUrl,
    DATA_DIR: opts.dataDir,
    DB_PATH: join(opts.dataDir, "conveyor.db"),
    CONVEYOR_PROFILES_ROOT: join(opts.root, "profiles"),
    PORT: String(opts.apiPort),
    CONVEYOR_API_TARGET: `http://127.0.0.1:${opts.apiPort}`,
  };
}

export async function bootStack(
  root: string,
  log: Log,
  deps: StackDeps = defaultDeps,
): Promise<Stack> {
  const handles: StackHandles = { children: [], cleanups: [] };
  const leftovers: string[] = [];
  const running = new Map<number, string>();
  const teardown = createTeardown(handles, { killAfterMs: KILL_AFTER_MS, sleep: deps.sleep });
  const detach = tearDownOnExit({
    events: deps.events,
    teardown,
    exit: deps.exit,
    report: (reason) => console.error(reason),
    leftovers: () => [
      ...[...running].map(([pid, name]) => `${name} process ${pid} (kill it with: kill -9 ${pid})`),
      ...leftovers,
    ],
  });
  const stop = async () => {
    try {
      await teardown();
    } finally {
      detach();
    }
  };
  try {
    const dataDir = await mkdtemp(join(tmpdir(), "conveyor-visual-"));
    handles.cleanups.push(() => rm(dataDir, { recursive: true, force: true }));
    leftovers.push(`temp directory ${dataDir}`);
    const redisUrl = await startRedis(deps, handles, leftovers);
    const apiPort = await freePort();
    const webPort = await freePort();
    const env = stackEnv(process.env, { root, redisUrl, dataDir, apiPort });
    await deps.seed(root, env);
    const launch = (name: string, cmd: string[], cwd: string) => {
      const proc = deps.spawn({ cmd, cwd, env });
      handles.children.push(proc);
      running.set(proc.pid, name);
      proc.exited.then(() => running.delete(proc.pid));
      pipeLines(name, proc.stdout, log).catch((err) =>
        log(`[${name}] stdout closed: ${messageOf(err)}`),
      );
      pipeLines(name, proc.stderr, log).catch((err) =>
        log(`[${name}] stderr closed: ${messageOf(err)}`),
      );
      return proc;
    };
    const api = launch("api", ["bun", "src/index.ts"], join(root, "packages/api"));
    await waitHttp(`http://127.0.0.1:${apiPort}/health`, 30000, api);
    launch("worker", ["bun", "src/index.ts"], join(root, "packages/worker"));
    const webDir = join(root, "packages/web");
    const buildExit = await launch("build", ["bun", "x", "vite", "build"], webDir).exited;
    if (buildExit !== 0) throw new Error(`vite build exited with ${buildExit}`);
    const web = launch(
      "web",
      [
        "bun",
        "x",
        "vite",
        "preview",
        "--host",
        "127.0.0.1",
        "--port",
        String(webPort),
        "--strictPort",
      ],
      webDir,
    );
    const url = `http://127.0.0.1:${webPort}`;
    await waitHttp(`${url}/`, 90000, web);
    return { url, stop };
  } catch (err) {
    await stop().catch((stopErr: unknown) => {
      throw new AggregateError([err, stopErr], `${messageOf(err)}; then ${messageOf(stopErr)}`);
    });
    throw err;
  }
}
