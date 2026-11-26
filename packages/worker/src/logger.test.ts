import { expect, test } from "bun:test";
import { createLogger, jobLog } from "./logger";

function captured() {
  const lines: Record<string, unknown>[] = [];
  const logger = createLogger({ write: (line: string) => void lines.push(JSON.parse(line)) });
  return { lines, logger };
}

test("worker log lines are JSON with a level name, an ISO time and the service", () => {
  const { lines, logger } = captured();
  logger.info({ component: "reaper" }, "swept");
  logger.error("history not recorded");
  expect(lines).toEqual([
    {
      level: "info",
      time: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
      service: "worker",
      component: "reaper",
      msg: "swept",
    },
    expect.objectContaining({ level: "error", service: "worker", msg: "history not recorded" }),
  ]);
});

test("a job's log lines carry its jobId", () => {
  const { lines, logger } = captured();
  jobLog("job-7", logger)("upload started");
  expect(lines).toEqual([
    expect.objectContaining({ level: "info", jobId: "job-7", msg: "upload started" }),
  ]);
});
