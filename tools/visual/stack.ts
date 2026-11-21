import { spawn, type Subprocess } from "bun";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export interface Stack {
  url: string;
  stop: () => Promise<void>;
}

const LOOPBACK = resolve(import.meta.dir, "loopback.ts");

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
  while (Date.now() < until) {
    if (proc && proc.exitCode !== null) throw new Error(`process for ${url} exited with ${proc.exitCode}`);
    try {
      const res = await fetch(url);
      if (res.status < 500) return;
    } catch {}
    await Bun.sleep(300);
  }
  throw new Error(`timed out waiting for ${url}`);
}

async function startRedis(): Promise<{ url: string; stop: () => Promise<void> }> {
  if (process.env.REDIS_URL) return { url: process.env.REDIS_URL, stop: async () => {} };
  const port = await freePort();
  const run = Bun.spawnSync(["docker", "run", "-d", "--rm", "-p", `127.0.0.1:${port}:6379`, "redis:7-alpine"]);
  if (run.exitCode !== 0) throw new Error(`docker run redis failed: ${run.stderr.toString()}`);
  const id = run.stdout.toString().trim();
  const until = Date.now() + 30000;
  while (Date.now() < until) {
    const ping = Bun.spawnSync(["docker", "exec", id, "redis-cli", "ping"]);
    if (ping.stdout.toString().includes("PONG")) break;
    await Bun.sleep(300);
  }
  return {
    url: `redis://127.0.0.1:${port}`,
    stop: async () => {
      Bun.spawnSync(["docker", "rm", "-f", id]);
    },
  };
}

export async function bootStack(root: string, log: (line: string) => void): Promise<Stack> {
  const dataDir = await mkdtemp(join(tmpdir(), "conveyor-visual-"));
  const redis = await startRedis();
  const apiPort = await freePort();
  const webPort = await freePort();
  const env = {
    ...process.env,
    CONVEYOR_ENGINE_STUB: "1",
    CONVEYOR_PASSWORD: "",
    REDIS_URL: redis.url,
    DATA_DIR: dataDir,
    DB_PATH: join(dataDir, "conveyor.db"),
    PORT: String(apiPort),
    CONVEYOR_API_TARGET: `http://127.0.0.1:${apiPort}`,
  };
  const procs: Subprocess[] = [];
  const launch = (name: string, cmd: string[], cwd: string) => {
    const proc = spawn({ cmd, cwd, env, stdout: "pipe", stderr: "pipe" });
    procs.push(proc);
    for (const stream of [proc.stdout, proc.stderr]) {
      void (async () => {
        const decoder = new TextDecoder();
        for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
          for (const line of decoder.decode(chunk).split("\n")) if (line.trim()) log(`[${name}] ${line}`);
        }
      })();
    }
    return proc;
  };
  const stop = async () => {
    for (const p of procs) p.kill();
    await Promise.all(procs.map((p) => p.exited));
    await redis.stop();
    await rm(dataDir, { recursive: true, force: true });
  };
  try {
    const api = launch("api", ["bun", "--preload", LOOPBACK, "src/index.ts"], join(root, "packages/api"));
    await waitHttp(`http://127.0.0.1:${apiPort}/health`, 30000, api);
    launch("worker", ["bun", "--preload", LOOPBACK, "src/index.ts"], join(root, "packages/worker"));
    const webDir = join(root, "packages/web");
    const build = launch("build", ["bun", "x", "vite", "build"], webDir);
    if ((await build.exited) !== 0) throw new Error("vite build failed");
    const web = launch(
      "web",
      ["bun", "x", "vite", "preview", "--host", "127.0.0.1", "--port", String(webPort), "--strictPort"],
      webDir,
    );
    const url = `http://127.0.0.1:${webPort}`;
    await waitHttp(`${url}/`, 90000, web);
    await fetch(`${url}/`);
    return { url, stop };
  } catch (err) {
    await stop();
    throw err;
  }
}
