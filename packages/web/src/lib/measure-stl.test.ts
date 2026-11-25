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
    const measuring = measureStl(file, () => fake.worker);
    expect(fake.posted).toEqual([file]);
    fake.answer({ x: 20, y: 10, z: 30 });
    expect(await measuring).toEqual({ x: 20, y: 10, z: 30 });
    expect(fake.terminated()).toBe(1);
  });

  test("a worker that fails gives no size and is stopped", async () => {
    const fake = fakeWorker();
    const measuring = measureStl(new File(["x"], "x.stl"), () => fake.worker);
    fake.fail();
    expect(await measuring).toBeNull();
    expect(fake.terminated()).toBe(1);
  });
});
