import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { harness } from "./pipeline-harness";

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
    expect(h.records[0].reason).toStartWith("work dir not removed: ");
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
