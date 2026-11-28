import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { childPids, claimBrowser, closeOrKill, rejection, SECOND_BROWSER } from "./fixtures.ts";

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

test("rejection gives a rejected call's whole message, and fails a call that resolves", async () => {
  expect(await rejection(Promise.reject(new Error("first\nsecond")))).toBe("first\nsecond");
  expect(await rejection(Promise.reject("plain"))).toBe("plain");
  expect(await rejection(rejection(Promise.resolve(1)))).toBe(
    "expected it to reject, but it resolved",
  );
});

const awaitsRejects = (text: string) =>
  /=\s*browserPages\(\)/.test(text) && /\)\s*\.rejects\b/.test(text);

test("the .rejects guard catches the call on one line and split by the formatter", () => {
  const browser = ["const withPage = browserPages", "();\n"].join("");
  const call = ['await expect(assertRing(page, "button"))', '.rejects.toThrow("x");'];
  expect(awaitsRejects(browser + call.join(""))).toBe(true);
  expect(awaitsRejects(browser + call.join("\n      "))).toBe(true);
  expect(awaitsRejects(`${browser}expect(await rejection(call)).toContain("x");`)).toBe(false);
  expect(awaitsRejects(call.join("\n      "))).toBe(false);
});

test("a browser test awaits rejection(), not expect().rejects, which Bun 1.4.5 stalls", () => {
  const offenders = readdirSync(import.meta.dir)
    .filter((name) => name.endsWith(".test.ts"))
    .filter((name) => awaitsRejects(readFileSync(join(import.meta.dir, name), "utf8")));
  expect(offenders).toEqual([]);
});
