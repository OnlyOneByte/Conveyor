import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CANCEL_TTL_SECONDS, jobCancelKey } from "@conveyor/shared";
import { openDb } from "@conveyor/shared/db";
import Fastify from "fastify";
import { registerErrorReplies } from "../error-replies.js";
import { connection, jobQueue, redis } from "../queue.js";
import { registerJobRoutes } from "./jobs.js";

connection.disconnect();
redis.disconnect();

const dir = mkdtempSync(join(tmpdir(), "conveyor-enqueue-failure-"));
const previous = process.env.DB_PATH;
const app = Fastify();
const request = {
  generator: { id: "gridfinity", params: {} },
  printerId: "klipper-garage",
  profileId: "orca/klipper-pla-0.2",
};

const fakes = {
  add: spyOn(jobQueue, "add").mockRejectedValue(new Error("Connection is closed.")),
  remove: spyOn(jobQueue, "remove").mockResolvedValue(1),
  set: spyOn(connection, "set").mockResolvedValue("OK"),
};

beforeAll(async () => {
  process.env.DB_PATH = join(dir, "conveyor.db");
  openDb();
  registerErrorReplies(app);
  await registerJobRoutes(app);
  await app.ready();
});

beforeEach(() => {
  for (const spy of Object.values(fakes)) spy.mockClear();
  connection.status = "ready";
});

afterEach(() => {
  connection.status = "end";
});

afterAll(async () => {
  await app.close();
  mock.restore();
  openDb().close();
  if (previous === undefined) delete process.env.DB_PATH;
  else process.env.DB_PATH = previous;
  rmSync(dir, { recursive: true, force: true });
});

const submit = () => app.inject({ method: "POST", url: "/jobs", payload: request });

async function until(seen: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !seen(); i++) await Bun.sleep(5);
}

describe("POST /jobs when the enqueue fails", () => {
  test("answers 503, then drops the job and sets its cancel flag once the queue is up", async () => {
    const res = await submit();
    expect(res.statusCode).toBe(503);
    expect(res.json<{ error: string }>()).toEqual({ error: "queue unavailable" });
    await until(() => fakes.set.mock.calls.length > 0);
    const jobId = fakes.add.mock.calls[0]?.[2]?.jobId ?? "";
    expect(fakes.remove).toHaveBeenCalledWith(jobId);
    expect(fakes.set).toHaveBeenCalledWith(jobCancelKey(jobId), "1", "EX", CANCEL_TTL_SECONDS);
  });

  test("logs each cleanup step that fails, naming the job", async () => {
    fakes.remove.mockRejectedValueOnce(new Error("Command timed out"));
    const logged = spyOn(app.log, "error");
    expect((await submit()).statusCode).toBe(503);
    await until(() => logged.mock.calls.length > 0);
    const jobId = fakes.add.mock.calls[0]?.[2]?.jobId ?? "";
    expect(logged.mock.calls).toEqual([
      [{ err: new Error("Command timed out"), jobId }, "abandoned job remove failed"],
    ]);
    logged.mockRestore();
  });

  test("waits for a reconnecting connection, then drops the job, since the add may have landed", async () => {
    connection.status = "reconnecting";
    expect((await submit()).statusCode).toBe(503);
    await Bun.sleep(20);
    expect(fakes.remove).not.toHaveBeenCalled();
    connection.status = "ready";
    connection.emit("ready");
    await until(() => fakes.set.mock.calls.length > 0);
    const jobId = fakes.add.mock.calls[0]?.[2]?.jobId ?? "";
    expect(fakes.remove).toHaveBeenCalledWith(jobId);
    expect(fakes.set).toHaveBeenCalledWith(jobCancelKey(jobId), "1", "EX", CANCEL_TTL_SECONDS);
  });

  test("answers 503 for a command cut off mid-flight", async () => {
    fakes.add.mockRejectedValueOnce(
      Object.assign(new Error("Reached the max retries per request limit (which is 0)."), {
        name: "MaxRetriesPerRequestError",
      }),
    );
    expect((await submit()).statusCode).toBe(503);
  });

  test("still answers 503 when the queue connection ends before it can drop the job", async () => {
    connection.status = "reconnecting";
    const logged = spyOn(app.log, "error");
    const res = await submit();
    expect(res.statusCode).toBe(503);
    connection.emit("end");
    await until(() => logged.mock.calls.length > 0);
    expect(logged.mock.calls[0]?.[1]).toBe("queue never came up to drop the job");
    logged.mockRestore();
    expect(fakes.remove).not.toHaveBeenCalled();
    expect(fakes.set).not.toHaveBeenCalled();
  });
});
