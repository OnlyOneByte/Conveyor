import { expect, test } from "bun:test";
import Fastify from "fastify";
import { logCancel, logSubmitted } from "./submit.js";

function captured() {
  const lines: Record<string, unknown>[] = [];
  const app = Fastify({
    logger: {
      base: undefined,
      timestamp: false,
      stream: { write: (line: string) => void lines.push(JSON.parse(line)) },
    },
  });
  return { lines, log: app.log };
}

const request = {
  generator: { id: "gridfinity", params: { gridX: 2 } },
  printerId: "klipper-garage",
  profileId: "orca/klipper-pla-0.2",
};

test("a queued job is logged with its jobId, generator and printer, not its params", () => {
  const { lines, log } = captured();
  logSubmitted(log, { request, retryOf: "old" }, { code: 202, body: { jobId: "j1" } });
  expect(lines).toEqual([
    {
      level: 30,
      jobId: "j1",
      generatorId: "gridfinity",
      printerId: "klipper-garage",
      retryOf: "old",
      msg: "job queued",
    },
  ]);
});

test("a refused retry and a cancel are logged with their job ids", () => {
  const { lines, log } = captured();
  logSubmitted(
    log,
    { request, retryOf: "old" },
    {
      code: 409,
      body: { error: "retryOf: job old was already retried", retriedBy: "j2" },
    },
  );
  logCancel(log, "j3", 202);
  expect(lines).toEqual([
    { level: 30, retryOf: "old", retriedBy: "j2", msg: "job retry refused: already retried" },
    { level: 30, jobId: "j3", code: 202, msg: "job cancel requested" },
  ]);
});
