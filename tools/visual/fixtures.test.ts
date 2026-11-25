import { expect, test } from "bun:test";
import { join } from "node:path";
import { childPids, claimBrowser, closeOrKill, SECOND_BROWSER } from "./fixtures.ts";

const hang = () => new Promise<void>(() => {});

test("a browser that closes in time is not killed, and the call returns as soon as it closes", async () => {
  const killed: number[] = [];
  const start = performance.now();
  expect(
    await closeOrKill(
      async () => {},
      4242,
      (pid) => killed.push(pid),
      5000,
    ),
  ).toBe("closed");
  expect(performance.now() - start).toBeLessThan(1000);
  expect(killed).toEqual([]);
});

test("a close that finishes in time leaves no timer keeping the process alive", () => {
  const fixtures = join(import.meta.dir, "fixtures.ts");
  const script = `const { closeOrKill } = await import(${JSON.stringify(fixtures)}); console.log(await closeOrKill(async () => {}, 1, () => {}, 10000));`;
  const start = performance.now();
  const run = Bun.spawnSync(["bun", "-e", script], { timeout: 20000 });
  expect(run.stdout.toString().trim()).toBe("closed");
  expect(performance.now() - start).toBeLessThan(5000);
}, 30000);

test("a browser whose close hangs is killed by the PID it was launched with, and only that one", async () => {
  const killed: number[] = [];
  expect(await closeOrKill(hang, 4242, (pid) => killed.push(pid), 200)).toBe("killed");
  expect(killed).toEqual([4242]);
});

test("a close that hangs with no PID to kill says it hung", async () => {
  const killed: number[] = [];
  expect(await closeOrKill(hang, undefined, (pid) => killed.push(pid), 50)).toBe("hung");
  expect(killed).toEqual([]);
});

test("a second browser in one process is refused before it can hang", () => {
  const store: Record<symbol, boolean | undefined> = {};
  claimBrowser(store);
  expect(() => claimBrowser(store)).toThrow(SECOND_BROWSER);
});

test.skipIf(process.platform !== "linux")(
  "childPids finds a process this one spawned",
  async () => {
    const child = Bun.spawn(["sleep", "5"]);
    try {
      expect(childPids()).toContain(child.pid);
    } finally {
      child.kill();
      await child.exited;
    }
  },
);
