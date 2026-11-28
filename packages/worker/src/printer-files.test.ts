import { describe, expect, test } from "bun:test";
import {
  type PrinterTarget,
  PrintMayHaveStartedError,
  PrintNotStartedError,
  type PrintStatus,
} from "@conveyor/shared";
import { harness, never, waitForAbort } from "../test/helpers/pipeline-harness";
import { DEFAULT_KEEP_FILES, printerKeepFiles } from "./printer-files";

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

describe("CONVEYOR_PRINTER_KEEP_FILES", () => {
  test("defaults to keeping the last 5 prints", () => {
    expect(printerKeepFiles({})).toBe(DEFAULT_KEEP_FILES);
    expect(DEFAULT_KEEP_FILES).toBe(5);
    expect(printerKeepFiles({ CONVEYOR_PRINTER_KEEP_FILES: " " })).toBe(5);
  });

  test("takes a whole number, 0 or more", () => {
    expect(printerKeepFiles({ CONVEYOR_PRINTER_KEEP_FILES: "0" })).toBe(0);
    expect(printerKeepFiles({ CONVEYOR_PRINTER_KEEP_FILES: "1" })).toBe(1);
    expect(printerKeepFiles({ CONVEYOR_PRINTER_KEEP_FILES: " 12 " })).toBe(12);
  });

  test.each(["-1", "1.5", "lots", "0x10", "1e3", "+5", "Infinity", "99999999999999999999"])(
    "refuses %p",
    (raw) => {
      expect(() => printerKeepFiles({ CONVEYOR_PRINTER_KEEP_FILES: raw })).toThrow(
        `CONVEYOR_PRINTER_KEEP_FILES must be a whole number, 0 or more, got ${raw}`,
      );
    },
  );
});
