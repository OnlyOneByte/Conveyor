import { describe, expect, test } from "bun:test";
import { isQueueUnavailable, QueueUnavailableError, withinDeadline } from "./queue-reach";

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

  test("is false for a Redis reply error, any other error and a non-error", () => {
    expect(isQueueUnavailable(new Error("WRONGTYPE Operation against a key"))).toBe(false);
    expect(isQueueUnavailable(new TypeError("x is undefined"))).toBe(false);
    expect(isQueueUnavailable("Command timed out")).toBe(false);
  });
});
