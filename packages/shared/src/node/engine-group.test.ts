import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { testCtx } from "../../test/helpers/index.ts";
import { type GroupKill, killGroup, runEngine } from "./engine";

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function until(check: () => boolean, ms: number, what: string): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`${what} within ${ms} ms`);
    await Bun.sleep(5);
  }
}

test("an abort stops the engine's whole process group, so a wrapped engine writes nothing late", async () => {
  const ctx = testCtx();
  const inner = join(ctx.workDir, "inner.sh");
  const pidFile = join(ctx.workDir, "grandchild.pid");
  const late = join(ctx.workDir, "late");
  writeFileSync(inner, `echo $$ > "${pidFile}"\nsleep 2\ntouch "${late}"\n`);
  try {
    const run = runEngine("slicer", "sh", ["-c", 'sh "$0" & wait', inner], ctx).catch(
      (err: unknown) => err,
    );
    await until(
      () => existsSync(pidFile) && readFileSync(pidFile, "utf8").trim() !== "",
      3000,
      "the wrapped engine never started",
    );
    const grandchild = Number(readFileSync(pidFile, "utf8").trim());
    ctx.abort();
    expect(await run).toBeInstanceOf(Error);
    await until(() => !alive(grandchild), 1000, "the wrapped engine outlived the abort");
    expect(existsSync(late)).toBe(false);
  } finally {
    ctx.cleanup();
  }
});

function fakeKill(fail: Partial<Record<"SIGTERM" | "SIGKILL", string>>) {
  const sent: string[] = [];
  const how: GroupKill = {
    graceMs: 10,
    kill: (pid, signal) => {
      sent.push(`${signal} ${pid}`);
      const code = fail[signal];
      if (code) throw Object.assign(new Error(`kill ${code}`), { code });
    },
  };
  return { how, sent };
}

describe("killGroup", () => {
  test("sends nothing without a pid, or for pid 1, which would signal every process", () => {
    const ctx = testCtx();
    const { how, sent } = fakeKill({});
    killGroup(undefined, ctx, how);
    killGroup(1, ctx, how);
    expect(sent).toEqual([]);
    ctx.cleanup();
  });

  test("sends SIGTERM to the group, then SIGKILL after the grace, quietly if it is gone by then", async () => {
    const ctx = testCtx();
    const { how, sent } = fakeKill({ SIGKILL: "ESRCH" });
    killGroup(4242, ctx, how);
    expect(sent).toEqual(["SIGTERM -4242"]);
    await until(() => sent.length === 2, 1000, "no SIGKILL after the grace");
    expect(sent).toEqual(["SIGTERM -4242", "SIGKILL -4242"]);
    expect(ctx.logs).toEqual([]);
    ctx.cleanup();
  });

  test("a group already gone (ESRCH) is not an error and gets no SIGKILL", async () => {
    const ctx = testCtx();
    const { how, sent } = fakeKill({ SIGTERM: "ESRCH" });
    killGroup(4242, ctx, how);
    await Bun.sleep(30);
    expect(sent).toEqual(["SIGTERM -4242"]);
    expect(ctx.logs).toEqual([]);
    ctx.cleanup();
  });

  test("any other kill error is logged, for either signal", async () => {
    const ctx = testCtx();
    const term = fakeKill({ SIGTERM: "EPERM" });
    killGroup(4242, ctx, term.how);
    expect(ctx.logs).toEqual(["engine process group 4242 not sent SIGTERM: kill EPERM"]);
    const kill = fakeKill({ SIGKILL: "EPERM" });
    killGroup(4343, ctx, kill.how);
    await until(() => ctx.logs.length === 2, 1000, "the SIGKILL error was not logged");
    expect(ctx.logs[1]).toBe("engine process group 4343 not sent SIGKILL: kill EPERM");
    ctx.cleanup();
  });
});

test("a process that stops right after an abort still sends the SIGKILL before it exits", async () => {
  const ctx = testCtx();
  const script = join(ctx.workDir, "exit-after-abort.ts");
  const engine = join(import.meta.dir, "engine.ts");
  writeFileSync(
    script,
    [
      `import { killGroup } from ${JSON.stringify(engine)};`,
      "const sent = [];",
      "const how = { graceMs: 200, kill: (pid, signal) => { sent.push(signal); if (signal === 'SIGKILL') console.log(sent.join(' ')); } };",
      "killGroup(4242, { log: () => {} }, how);",
      "",
    ].join("\n"),
  );
  try {
    const child = Bun.spawn([process.execPath, script], { cwd: ctx.workDir, stdout: "pipe" });
    const exited = await Promise.race([child.exited, Bun.sleep(5000).then(() => "timeout")]);
    expect(exited).toBe(0);
    expect((await new Response(child.stdout).text()).trim()).toBe("SIGTERM SIGKILL");
  } finally {
    ctx.cleanup();
  }
});
