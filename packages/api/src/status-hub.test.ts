import { describe, expect, test } from "bun:test";
import { FakeSubscriber } from "../test/fake-subscriber.ts";
import { createStatusHub } from "./status-hub";

function hub() {
  const subscribers: FakeSubscriber[] = [];
  const errors: Error[] = [];
  const statusHub = createStatusHub(
    () => {
      const sub = new FakeSubscriber();
      subscribers.push(sub);
      return sub;
    },
    (error) => errors.push(error),
  );
  return { statusHub, subscribers, errors };
}

describe("createStatusHub", () => {
  test("serves every viewer of every job from one subscriber, one SUBSCRIBE per channel", async () => {
    const { statusHub, subscribers } = hub();
    const got: string[] = [];
    await statusHub.watch("a", (p) => got.push(`1:${p}`));
    await statusHub.watch("a", (p) => got.push(`2:${p}`));
    await statusHub.watch("b", (p) => got.push(`3:${p}`));
    subscribers[0]?.emit("a", "x");
    subscribers[0]?.emit("b", "y");
    expect(subscribers).toHaveLength(1);
    expect(statusHub.connections()).toBe(1);
    expect(subscribers[0]?.calls).toEqual(["subscribe a", "subscribe b"]);
    expect(got).toEqual(["1:x", "2:x", "3:y"]);
  });

  test("unsubscribes a channel when its last viewer leaves, and quits after the last of all", async () => {
    const { statusHub, subscribers } = hub();
    const leaveA1 = await statusHub.watch("a", () => {});
    const leaveA2 = await statusHub.watch("a", () => {});
    const leaveB = await statusHub.watch("b", () => {});
    leaveA1();
    leaveA1();
    expect(subscribers[0]?.calls).toEqual(["subscribe a", "subscribe b"]);
    leaveA2();
    expect(subscribers[0]?.calls.at(-1)).toBe("unsubscribe a");
    leaveB();
    expect(subscribers[0]?.calls.at(-1)).toBe("quit");
    expect(statusHub.connections()).toBe(0);
    await statusHub.watch("c", () => {});
    expect(subscribers).toHaveLength(2);
  });

  test("a refused SUBSCRIBE rejects the watch and leaves nothing open", async () => {
    const { statusHub, subscribers } = hub();
    const watching = statusHub.watch("a", () => {});
    const sub = subscribers[0];
    if (!sub) throw new Error("no subscriber");
    sub.failSubscribe = true;
    await expect(statusHub.watch("b", () => {})).rejects.toThrow("subscribe refused");
    await watching;
    expect(sub.calls.at(-1)).toBe("unsubscribe b");
    expect(statusHub.connections()).toBe(1);
  });

  test("reports subscriber errors instead of leaving them unhandled", async () => {
    const { statusHub, subscribers, errors } = hub();
    await statusHub.watch("a", () => {});
    subscribers[0]?.error(new Error("connection reset"));
    expect(errors.map((e) => e.message)).toEqual(["connection reset"]);
  });
});
