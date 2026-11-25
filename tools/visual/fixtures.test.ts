import { expect, test } from "bun:test";
import { childPids, closeOrKill } from "./fixtures.ts";

test("a browser that closes in time is not killed", async () => {
  const killed: number[] = [];
  expect(
    await closeOrKill(
      async () => {},
      4242,
      (pid) => killed.push(pid),
      200,
    ),
  ).toBe("closed");
  expect(killed).toEqual([]);
});

test("a browser whose close hangs is killed by the PID it was launched with, and only that one", async () => {
  const killed: number[] = [];
  const hang = () => new Promise<void>(() => {});
  expect(await closeOrKill(hang, 4242, (pid) => killed.push(pid), 200)).toBe("killed");
  expect(killed).toEqual([4242]);
});

test("without a PID there is nothing to kill", async () => {
  const killed: number[] = [];
  const hang = () => new Promise<void>(() => {});
  expect(await closeOrKill(hang, undefined, (pid) => killed.push(pid), 50)).toBe("closed");
  expect(killed).toEqual([]);
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
