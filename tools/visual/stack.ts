import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Subprocess, spawn } from "bun";
import { messageOf } from "./errors.ts";

export interface Stack {
  url: string;
  stop: () => Promise<void>;
}

type Log = (line: string) => void;

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

async function waitHttp(url: string, timeoutMs: number, proc?: Subprocess): Promise<void> {
  const until = Date.now() + timeoutMs;
  let last = "no response yet";
  while (Date.now() < until) {
    if (proc && proc.exitCode !== null)
      throw new Error(`process for ${url} exited with ${proc.exitCode}`);
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

async function startRedis(log: Log): Promise<{ url: string; stop: () => Promise<void> }> {
  if (process.env.REDIS_URL) return { url: process.env.REDIS_URL, stop: async () => {} };
  const port = await freePort();
  const run = Bun.spawnSync([
    "docker",
    "run",
    "-d",
    "--rm",
    "-p",
    `127.0.0.1:${port}:6379`,
    "redis:7-alpine",
  ]);
  if (run.exitCode !== 0) throw new Error(`docker run redis failed: ${run.stderr.toString()}`);
  const id = run.stdout.toString().trim();
  const until = Date.now() + 30000;
  let ready = false;
  while (!ready && Date.now() < until) {
    ready = Bun.spawnSync(["docker", "exec", id, "redis-cli", "ping"])
      .stdout.toString()
      .includes("PONG");
    if (!ready) await Bun.sleep(300);
  }
  if (!ready) {
    Bun.spawnSync(["docker", "rm", "-f", id]);
    throw new Error("redis did not answer PING within 30 s");
  }
  return {
    url: `redis://127.0.0.1:${port}`,
    stop: async () => {
      const removed = Bun.spawnSync(["docker", "rm", "-f", id]);
      if (removed.exitCode !== 0)
        log(`[redis] docker rm -f ${id} failed: ${removed.stderr.toString().trim()}`);
    },
  };
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
  opts: { redisUrl: string; dataDir: string; apiPort: number },
): Record<string, string | undefined> {
  return {
    ...base,
    CONVEYOR_ENGINE_STUB: "1",
    CONVEYOR_AUTH: "disabled",
    CONVEYOR_HOST: "127.0.0.1",
    REDIS_URL: opts.redisUrl,
    DATA_DIR: opts.dataDir,
    DB_PATH: join(opts.dataDir, "conveyor.db"),
    PORT: String(opts.apiPort),
    CONVEYOR_API_TARGET: `http://127.0.0.1:${opts.apiPort}`,
  };
}

export async function bootStack(root: string, log: Log): Promise<Stack> {
  const dataDir = await mkdtemp(join(tmpdir(), "conveyor-visual-"));
  const redis = await startRedis(log);
  const apiPort = await freePort();
  const webPort = await freePort();
  const env = stackEnv(process.env, { redisUrl: redis.url, dataDir, apiPort });
  const procs: Subprocess<"ignore", "pipe", "pipe">[] = [];
  const launch = (name: string, cmd: string[], cwd: string) => {
    const proc = spawn({ cmd, cwd, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    procs.push(proc);
    pipeLines(name, proc.stdout, log).catch((err) =>
      log(`[${name}] stdout closed: ${messageOf(err)}`),
    );
    pipeLines(name, proc.stderr, log).catch((err) =>
      log(`[${name}] stderr closed: ${messageOf(err)}`),
    );
    return proc;
  };
  const stop = async () => {
    for (const p of procs) p.kill();
    await Promise.all(procs.map((p) => p.exited));
    await redis.stop();
    await rm(dataDir, { recursive: true, force: true });
  };
  try {
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
    await stop();
    throw err;
  }
}
