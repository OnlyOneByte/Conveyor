import { afterEach, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Subprocess } from "bun";

const FAKE_DOCKER = `#!/bin/sh
case "$1" in
  run) echo fake-redis-id ;;
  exec) echo PONG ;;
  rm) echo "$3" >> "$VISUAL_TEST_MARKERS/docker-rm" ;;
esac
`;

const ORPHANED_API_EXIT_MS = 20000;

const HANGING_API = `const parent = process.ppid;
const watchesParent = process.env.VISUAL_TEST_API_WATCHES_PARENT === "1";
setInterval(() => {
  if (watchesParent && process.ppid !== parent) process.exit(0);
}, 100);
setTimeout(() => process.exit(0), ${ORPHANED_API_EXIT_MS});
await Bun.write(\`\${process.env.VISUAL_TEST_MARKERS}/api.pid\`, String(process.pid));
`;

const scratch: string[] = [];

afterEach(async () => {
  for (const dir of scratch.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function fixture() {
  const base = await mkdtemp(join(tmpdir(), "visual-capture-test-"));
  scratch.push(base);
  const dirs = {
    bin: join(base, "bin"),
    markers: join(base, "markers"),
    temp: join(base, "temp"),
    root: join(base, "root"),
  };
  for (const dir of Object.values(dirs)) await mkdir(dir, { recursive: true });
  await writeFile(join(dirs.bin, "docker"), FAKE_DOCKER);
  await chmod(join(dirs.bin, "docker"), 0o755);
  await mkdir(join(dirs.root, "packages/api/src"), { recursive: true });
  await writeFile(join(dirs.root, "packages/api/src/index.ts"), HANGING_API);
  return { base, ...dirs };
}

type Dirs = Awaited<ReturnType<typeof fixture>>;

async function waitFor<T>(read: () => Promise<T | undefined>, what: string, timeoutMs: number) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const value = await read();
    if (value !== undefined) return value;
    await Bun.sleep(50);
  }
  throw new Error(`${what} within ${timeoutMs} ms`);
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function killIfAlive(pid: number): void {
  if (isAlive(pid)) process.kill(pid, "SIGKILL");
}

function startCapture(
  dirs: Dirs,
  apiWatchesParent: boolean,
): Subprocess<"ignore", "ignore", "pipe"> {
  return Bun.spawn({
    cmd: [
      process.execPath,
      join(import.meta.dir, "capture.ts"),
      "--root",
      dirs.root,
      "--out",
      join(dirs.base, "out"),
    ],
    cwd: dirs.base,
    env: {
      ...process.env,
      PATH: `${dirs.bin}:${process.env.PATH ?? ""}`,
      TMPDIR: dirs.temp,
      VISUAL_TEST_MARKERS: dirs.markers,
      VISUAL_TEST_API_WATCHES_PARENT: apiWatchesParent ? "1" : "0",
    },
    stdin: "ignore",
    stdout: "ignore",
    stderr: "pipe",
  });
}

async function withBootingCapture(
  dirs: Dirs,
  options: { apiWatchesParent: boolean },
  body: (capture: Subprocess<"ignore", "ignore", "pipe">, apiPid: number) => Promise<void>,
): Promise<number> {
  const capture = startCapture(dirs, options.apiWatchesParent);
  let apiPid = 0;
  try {
    const pidText = await waitFor(
      () => readFile(join(dirs.markers, "api.pid"), "utf8").catch(() => undefined),
      "the fake api did not write its pid",
      15000,
    );
    apiPid = Number(pidText);
    await body(capture, apiPid);
  } finally {
    capture.kill("SIGKILL");
    if (apiPid > 0) killIfAlive(apiPid);
  }
  return apiPid;
}

async function waitUntilDead(pid: number, timeoutMs: number): Promise<void> {
  await waitFor(async () => (isAlive(pid) ? undefined : true), `pid ${pid} still ran`, timeoutMs);
}

test("SIGINT to a real capture.ts run stops the api, removes the container and the temp dir, and exits 130", async () => {
  const dirs = await fixture();
  await withBootingCapture(dirs, { apiWatchesParent: true }, async (capture, apiPid) => {
    expect(await readdir(dirs.temp)).toHaveLength(1);
    capture.kill("SIGINT");
    expect(await capture.exited).toBe(130);
    expect(await readFile(join(dirs.markers, "docker-rm"), "utf8")).toBe("fake-redis-id\n");
    expect(isAlive(apiPid)).toBe(false);
    expect(await readdir(dirs.temp)).toEqual([]);
  });
}, 30000);

test("a failing assertion mid-run kills the api even when it does not watch its parent", async () => {
  const dirs = await fixture();
  let apiPid = 0;
  const run = withBootingCapture(dirs, { apiWatchesParent: false }, async (_capture, pid) => {
    apiPid = pid;
    throw new Error("simulated assertion failure");
  });
  await expect(run).rejects.toThrow("simulated assertion failure");
  await waitUntilDead(apiPid, 5000);
}, 30000);

test("the fake api exits by itself once its parent is gone", async () => {
  const dirs = await fixture();
  const capture = startCapture(dirs, true);
  const pidText = await waitFor(
    () => readFile(join(dirs.markers, "api.pid"), "utf8").catch(() => undefined),
    "the fake api did not write its pid",
    15000,
  );
  const apiPid = Number(pidText);
  try {
    capture.kill("SIGKILL");
    await capture.exited;
    await waitUntilDead(apiPid, 5000);
  } finally {
    killIfAlive(apiPid);
  }
}, 30000);
