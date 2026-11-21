import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { harness, states } from "./pipeline-harness";

const locked: string[] = [];

afterEach(async () => {
  for (const dir of locked.splice(0)) {
    await chmod(dir, 0o700);
    await rm(dir, { recursive: true, force: true });
  }
});

async function unremovableWorkDir(): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), "conveyor-settle-"));
  const workDir = join(parent, "job");
  await mkdir(workDir);
  await writeFile(join(workDir, "model.gcode"), "G28\n");
  await chmod(parent, 0o500);
  locked.push(parent);
  return workDir;
}

const asRoot = process.getuid?.() === 0;

describe.skipIf(asRoot)("a work dir that cannot be removed", () => {
  test("a canceled job stays canceled and carries the note", async () => {
    const h = harness({ cancelRequested: async () => true, workDir: await unremovableWorkDir() });
    expect(await h.run()).toBe("canceled");
    expect(h.records[0].state).toBe("canceled");
    expect(h.records[0].reason).toBeUndefined();
    expect(h.records[0].notes).toStartWith("work dir not removed: ");
    expect(h.events.at(-1)?.state).toBe("canceled");
    expect(h.events.at(-1)?.message).toStartWith("work dir not removed: ");
  });

  test("a failed job keeps its reason with the note appended", async () => {
    const h = harness({
      workDir: await unremovableWorkDir(),
      status: async function* () {
        yield { state: "failed", message: "thermal runaway" };
      },
    });
    await expect(h.run()).rejects.toThrow("thermal runaway");
    expect(h.records[0].state).toBe("failed");
    expect(h.records[0].reason).toStartWith("thermal runaway; work dir not removed: ");
  });
});

describe("job history on settlement", () => {
  test("history is written before the done status is published", async () => {
    let lastStateAtRecord: string | undefined;
    const h = harness({
      record: () => {
        lastStateAtRecord = states(h).at(-1);
      },
    });
    expect(await h.run()).toBe("done");
    expect(lastStateAtRecord).toBe("transferring");
    expect(h.records).toEqual([{ state: "done", reason: undefined, notes: undefined }]);
  });

  test("a history write that fails once is retried and the job finishes done", async () => {
    let attempts = 0;
    const h = harness({
      record: () => {
        attempts++;
        if (attempts === 1) throw new Error("database is locked");
      },
    });
    expect(await h.run()).toBe("done");
    expect(attempts).toBe(2);
    expect(h.records).toHaveLength(1);
    expect(h.events.at(-1)?.message).toBeUndefined();
  });

  test("a history write that keeps failing is shown on the done status and rejects", async () => {
    let attempts = 0;
    const h = harness({
      record: () => {
        attempts++;
        throw new Error("database is locked");
      },
    });
    const expected = "history not recorded after 3 attempts: database is locked";
    await expect(h.run()).rejects.toThrow(expected);
    expect(attempts).toBe(3);
    expect(h.events.at(-1)).toEqual({ state: "done", message: expected, reason: undefined });
  });

  test("a failed job whose history keeps failing rejects with both reasons", async () => {
    const h = harness({
      status: async function* () {
        yield { state: "failed", message: "thermal runaway" };
      },
      record: () => {
        throw new Error("disk I/O error");
      },
    });
    const run = h.run();
    await expect(run).rejects.toThrow("thermal runaway");
    await expect(run).rejects.toThrow("history not recorded after 3 attempts: disk I/O error");
    expect(h.events.at(-1)?.reason).toBe(
      "thermal runaway; history not recorded after 3 attempts: disk I/O error",
    );
  });
});
