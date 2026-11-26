import type { Database } from "bun:sqlite";
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type PrinterTarget,
  PrintMayHaveStartedError,
  PrintNotStartedError,
  type PrintStatus,
  type Stage,
  StageError,
} from "@conveyor/shared";
import { dbGetJob, dbRecordJob, openDb } from "@conveyor/shared/db";
import {
  type HarnessOptions,
  harness,
  never,
  waitForAbort,
} from "../test/helpers/pipeline-harness";
import { settledJob } from "./index";
import { DEFAULT_KEEP_FILES, filesToKeep, printerKeepFiles } from "./printer-files";
import type { PipelineDeps } from "./run";

interface Pruned {
  printerId: string;
  keep: string[];
}

function pruning(fail?: Error) {
  const calls: Pruned[] = [];
  const logs: string[] = [];
  const pruneFiles = async (target: PrinterTarget, keep: ReadonlySet<string>) => {
    calls.push({ printerId: target.id, keep: [...keep] });
    if (fail) throw fail;
    return ["conveyor-old.gcode"];
  };
  const deps = () => ({
    printerFilesToKeep: (printerId: string, jobId: string) => [`${printerId}:${jobId}`],
    log: (line: string) => logs.push(line),
  });
  return { calls, logs, pruneFiles, deps };
}

async function* failsMidPrint(): AsyncIterable<PrintStatus> {
  yield { state: "printing", progress: 0.2 };
  yield { state: "failed", message: "nozzle clog" };
}

describe("old files on the printer", () => {
  test("are pruned once a print finishes, keeping what the worker names", async () => {
    const p = pruning();
    const h = harness({ pruneFiles: p.pruneFiles, deps: p.deps });
    expect(await h.run()).toBe("done");
    expect(p.calls).toEqual([{ printerId: "p1", keep: ["p1:job-1"] }]);
    expect(p.logs).toContain("job job-1: removed old files from the printer: conveyor-old.gcode");
  });

  test("are pruned after a print that failed on the printer", async () => {
    const p = pruning();
    const h = harness({ pruneFiles: p.pruneFiles, deps: p.deps, status: failsMidPrint });
    await expect(h.run()).rejects.toThrow("nozzle clog");
    expect(p.calls).toHaveLength(1);
  });

  test("are left alone when the print may have started", async () => {
    const p = pruning();
    const submit = async () => {
      throw new PrintMayHaveStartedError("moonraker gave no answer to print start");
    };
    const h = harness({ pruneFiles: p.pruneFiles, deps: p.deps, submit });
    await expect(h.run()).rejects.toThrow("moonraker gave no answer to print start");
    expect(p.calls).toEqual([]);
  });

  test("are left alone when the print was refused before it started", async () => {
    const p = pruning();
    const submit = async () => {
      throw new PrintNotStartedError("printer is busy: moonraker reports it printing");
    };
    const h = harness({ pruneFiles: p.pruneFiles, deps: p.deps, submit });
    await expect(h.run()).rejects.toThrow("printer is busy");
    expect(p.calls).toEqual([]);
  });

  test("are left alone when the job is canceled", async () => {
    const p = pruning();
    const h = harness({
      pruneFiles: p.pruneFiles,
      deps: p.deps,
      status: async function* (_handle, signal) {
        yield { state: "printing", progress: 0.1 };
        h.controller.abort();
        await (signal ? waitForAbort(signal) : never());
      },
    });
    expect(await h.run()).toBe("canceled");
    expect(p.calls).toEqual([]);
  });

  test("a failed prune is logged and never fails the job", async () => {
    const p = pruning(new Error("printer unreachable"));
    const h = harness({ pruneFiles: p.pruneFiles, deps: p.deps });
    expect(await h.run()).toBe("done");
    expect(p.logs).toContain("job job-1: printer file cleanup did not finish: printer unreachable");
  });

  test("are pruned while the printer lock is still held", async () => {
    const order: string[] = [];
    const p = pruning();
    const pruneFiles = async (target: PrinterTarget, keep: ReadonlySet<string>) => {
      order.push("pruned");
      return p.pruneFiles(target, keep);
    };
    const printerLock = {
      acquire: async () => {
        order.push("locked");
        return { confirm: async () => {}, release: async () => void order.push("released") };
      },
    };
    const h = harness({ pruneFiles, deps: () => ({ ...p.deps(), printerLock }) });
    expect(await h.run()).toBe("done");
    expect(order).toEqual(["locked", "pruned", "released"]);
  });
});

describe("filesToKeep", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  interface Row {
    id: string;
    printerId: string;
    at: number;
    stage?: Stage;
  }

  function dbWith(jobs: Row[]) {
    const dir = mkdtempSync(join(tmpdir(), "conveyor-printer-files-"));
    dirs.push(dir);
    const db = openDb(join(dir, "conveyor.db"));
    for (const { id, printerId, stage } of jobs)
      dbRecordJob(db, { id, generatorId: "g", printerId, profileId: "x", state: "done", stage });
    for (const { id, at } of jobs) db.run("UPDATE jobs SET updated_at = ? WHERE id = ?", [at, id]);
    return db;
  }

  test("keeps this job's file and the printer's most recent earlier ones, up to N", () => {
    const db = dbWith([
      { id: "old", printerId: "p1", at: 1 },
      { id: "new", printerId: "p1", at: 3 },
      { id: "mid", printerId: "p1", at: 2 },
      { id: "other", printerId: "p2", at: 4 },
    ]);
    expect(filesToKeep(db, 3, "p1", "now")).toEqual([
      "conveyor-now.gcode",
      "conveyor-new.gcode",
      "conveyor-mid.gcode",
    ]);
    expect(filesToKeep(db, 1, "p1", "now")).toEqual(["conveyor-now.gcode"]);
  });

  async function settle(db: Database, id: string, at: number, opts: HarnessOptions = {}) {
    const record: PipelineDeps["record"] = (_id, req, extra) =>
      dbRecordJob(db, settledJob(id, req, extra));
    await harness({ ...opts, deps: () => ({ record }) })
      .run()
      .catch(() => undefined);
    db.run("UPDATE jobs SET updated_at = ? WHERE id = ?", [at, id]);
  }

  const failsAt = (stage: "generator" | "slicer") => async () => {
    throw new StageError(stage, `${stage} broke`);
  };

  test("counts only jobs that reached the printer toward N, as the worker records them", async () => {
    const db = dbWith([]);
    await settle(db, "printed", 1);
    await settle(db, "failed-printing", 2, { status: failsMidPrint });
    await settle(db, "sliced-badly", 3, { slice: failsAt("slicer") });
    await settle(db, "never-made", 4, { generate: failsAt("generator") });
    expect(dbGetJob(db, "printed")?.state).toBe("done");
    expect(db.query("SELECT stage FROM jobs WHERE id = 'printed'").get()).toEqual({ stage: null });
    expect(dbGetJob(db, "never-made")?.state).toBe("failed");
    expect(filesToKeep(db, 3, "p1", "now")).toEqual([
      "conveyor-now.gcode",
      "conveyor-failed-printing.gcode",
      "conveyor-printed.gcode",
    ]);
    expect(filesToKeep(db, 2, "p1", "now")).toEqual([
      "conveyor-now.gcode",
      "conveyor-failed-printing.gcode",
    ]);
  });

  test("keeps no earlier job's file at 0, nor names this job's own", () => {
    expect(filesToKeep(dbWith([{ id: "a", printerId: "p1", at: 1 }]), 0, "p1", "now")).toEqual([]);
  });

  test("counts this job once even if its row is already there", () => {
    const db = dbWith([
      { id: "now", printerId: "p1", at: 2 },
      { id: "a", printerId: "p1", at: 1 },
    ]);
    expect(filesToKeep(db, 2, "p1", "now")).toEqual(["conveyor-now.gcode", "conveyor-a.gcode"]);
  });
});

describe("CONVEYOR_PRINTER_KEEP_FILES", () => {
  test("defaults to keeping the last print", () => {
    expect(printerKeepFiles({})).toBe(DEFAULT_KEEP_FILES);
    expect(DEFAULT_KEEP_FILES).toBe(1);
    expect(printerKeepFiles({ CONVEYOR_PRINTER_KEEP_FILES: " " })).toBe(1);
  });

  test("takes a whole number, 0 or more", () => {
    expect(printerKeepFiles({ CONVEYOR_PRINTER_KEEP_FILES: "0" })).toBe(0);
    expect(printerKeepFiles({ CONVEYOR_PRINTER_KEEP_FILES: "5" })).toBe(5);
  });

  test.each(["-1", "1.5", "lots"])("refuses %p", (raw) => {
    expect(() => printerKeepFiles({ CONVEYOR_PRINTER_KEEP_FILES: raw })).toThrow(
      `CONVEYOR_PRINTER_KEEP_FILES must be a whole number, 0 or more, got ${raw}`,
    );
  });
});
