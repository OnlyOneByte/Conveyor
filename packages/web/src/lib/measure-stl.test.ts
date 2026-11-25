import { describe, expect, test } from "bun:test";
import { type MeasureWorker, measureStl } from "./measure-stl.js";

function fakeWorker() {
  const posted: unknown[] = [];
  let terminated = 0;
  const worker: MeasureWorker = {
    onmessage: null,
    onerror: null,
    postMessage: (message: File) => {
      posted.push(message);
    },
    terminate: () => {
      terminated++;
    },
  };
  const answer = (data: { x: number; y: number; z: number } | null) =>
    worker.onmessage?.(new MessageEvent("message", { data }));
  const fail = () => worker.onerror?.(new ErrorEvent("error"));
  return { worker, posted, answer, fail, terminated: () => terminated };
}

describe("measureStl", () => {
  test("hands the file to a worker, resolves its answer and stops the worker", async () => {
    const fake = fakeWorker();
    const file = new File(["solid"], "cube.stl");
    const measuring = measureStl(file, undefined, () => fake.worker);
    expect(fake.posted).toEqual([file]);
    fake.answer({ x: 20, y: 10, z: 30 });
    expect(await measuring).toEqual({ x: 20, y: 10, z: 30 });
    expect(fake.terminated()).toBe(1);
  });

  test("a worker that fails gives no size and is stopped", async () => {
    const fake = fakeWorker();
    const measuring = measureStl(new File(["x"], "x.stl"), undefined, () => fake.worker);
    fake.fail();
    expect(await measuring).toBeNull();
    expect(fake.terminated()).toBe(1);
  });

  test("aborting a measurement stops its worker at once, so a new file never runs beside it", async () => {
    const first = fakeWorker();
    const second = fakeWorker();
    const old = new AbortController();
    const stale = measureStl(new File(["big"], "big.stl"), old.signal, () => first.worker);
    old.abort();
    expect(first.terminated()).toBe(1);
    expect(await stale).toBeNull();
    const current = measureStl(
      new File(["cube"], "cube.stl"),
      new AbortController().signal,
      () => second.worker,
    );
    second.answer({ x: 1, y: 2, z: 3 });
    expect(await current).toEqual({ x: 1, y: 2, z: 3 });
    first.answer({ x: 9, y: 9, z: 9 });
    expect(first.terminated()).toBe(1);
  });

  test("an already-aborted measurement starts no worker", async () => {
    const aborted = new AbortController();
    aborted.abort();
    let spawned = 0;
    const measured = await measureStl(new File(["x"], "x.stl"), aborted.signal, () => {
      spawned++;
      return fakeWorker().worker;
    });
    expect([measured, spawned]).toEqual([null, 0]);
  });
});
