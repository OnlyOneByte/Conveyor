import { afterEach, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const FAKE_DOCKER = `#!/bin/sh
case "$1" in
  run) echo fake-redis-id ;;
  exec) echo PONG ;;
  rm) echo "$3" >> "$VISUAL_TEST_MARKERS/docker-rm" ;;
esac
`;

const HANGING_API = `await Bun.write(\`\${process.env.VISUAL_TEST_MARKERS}/api.pid\`, String(process.pid));
setInterval(() => {}, 60000);
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

async function waitForFile(path: string, timeoutMs: number): Promise<string> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const text = await readFile(path, "utf8").catch(() => "");
    if (text) return text;
    await Bun.sleep(50);
  }
  throw new Error(`${path} did not appear within ${timeoutMs} ms`);
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test("SIGINT to a real capture.ts run stops the api, removes the container and the temp dir, and exits 130", async () => {
  const dirs = await fixture();
  const capture = Bun.spawn({
    cmd: [
      "bun",
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
    },
    stdout: "ignore",
    stderr: "pipe",
  });
  try {
    const apiPid = Number(await waitForFile(join(dirs.markers, "api.pid"), 15000));
    expect(await readdir(dirs.temp)).toHaveLength(1);
    capture.kill("SIGINT");
    expect(await capture.exited).toBe(130);
    expect(await readFile(join(dirs.markers, "docker-rm"), "utf8")).toBe("fake-redis-id\n");
    expect(isAlive(apiPid)).toBe(false);
    expect(await readdir(dirs.temp)).toEqual([]);
  } finally {
    capture.kill("SIGKILL");
  }
}, 30000);
