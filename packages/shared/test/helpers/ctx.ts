import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StageCtx } from "../../src/context.ts";

export interface ProgressReport {
  progress: number;
  message?: string;
}

export interface TestCtx extends StageCtx {
  reports: ProgressReport[];
  logs: string[];
  abort: (reason?: unknown) => void;
  cleanup: () => void;
}

export function testCtx(jobId = "job-test"): TestCtx {
  const controller = new AbortController();
  const workDir = mkdtempSync(join(tmpdir(), "conveyor-ctx-"));
  const reports: ProgressReport[] = [];
  const logs: string[] = [];
  return {
    jobId,
    workDir,
    signal: controller.signal,
    reports,
    logs,
    report: (progress, message) => {
      reports.push(message === undefined ? { progress } : { progress, message });
    },
    log: (msg) => {
      logs.push(msg);
    },
    abort: (reason) => controller.abort(reason),
    cleanup: () => rmSync(workDir, { recursive: true, force: true }),
  };
}
