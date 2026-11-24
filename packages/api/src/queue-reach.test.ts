import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import MaxRetriesPerRequestError from "ioredis/built/errors/MaxRetriesPerRequestError.js";
import {
  isQueueUnavailable,
  QueueUnavailableError,
  untilReady,
  withinDeadline,
} from "./queue-reach";

function client(status: string) {
  return Object.assign(new EventEmitter(), { status });
}

describe("untilReady", () => {
  test("answers at once for a ready connection", async () => {
    await untilReady(client("ready"), 1_000);
  });

  test("waits for the connection to come back", async () => {
    const reconnecting = client("reconnecting");
    const back = untilReady(reconnecting, 1_000);
    reconnecting.emit("ready");
    await back;
    expect(reconnecting.listenerCount("end")).toBe(0);
  });

  test("gives up when the connection ends or stays down past the bound", async () => {
    const ending = client("reconnecting");
    const ended = untilReady(ending, 1_000);
    ending.emit("end");
    await expect(ended).rejects.toBeInstanceOf(QueueUnavailableError);
    const down = client("reconnecting");
    await expect(untilReady(down, 5)).rejects.toBeInstanceOf(QueueUnavailableError);
    expect(down.listenerCount("ready")).toBe(0);
  });
});

describe("withinDeadline", () => {
  test("answers with the call's value when it settles in time", async () => {
    expect(await withinDeadline(Promise.resolve("ok"), 1_000)).toBe("ok");
  });

  test("passes the call's own error through", async () => {
    const err = new Error("WRONGTYPE");
    await expect(withinDeadline(Promise.reject(err), 1_000)).rejects.toBe(err);
  });

  test("gives up with QueueUnavailableError when the call never settles", async () => {
    const never = new Promise<never>(() => undefined);
    const failure = await withinDeadline(never, 5).then(
      () => undefined,
      (err: unknown) => err,
    );
    expect(failure).toBeInstanceOf(QueueUnavailableError);
    expect(isQueueUnavailable(failure)).toBe(true);
  });
});

describe("isQueueUnavailable", () => {
  test("is true for each way ioredis says it can't reach Redis", () => {
    for (const message of [
      "Command timed out",
      "Connection is closed.",
      "Stream isn't writeable and enableOfflineQueue options is false",
    ])
      expect(isQueueUnavailable(new Error(message))).toBe(true);
  });

  test("is true for a command cut off when its connection dropped", () => {
    expect(isQueueUnavailable(new MaxRetriesPerRequestError(0))).toBe(true);
  });

  test("is false for a Redis reply error, any other error and a non-error", () => {
    expect(isQueueUnavailable(new Error("WRONGTYPE Operation against a key"))).toBe(false);
    expect(isQueueUnavailable(new TypeError("x is undefined"))).toBe(false);
    expect(isQueueUnavailable("Command timed out")).toBe(false);
  });
});
