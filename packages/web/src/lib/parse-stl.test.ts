import { describe, expect, test } from "bun:test";
import { type ParsedStl, type ParseWorker, parseStl } from "./parse-stl.js";

const TRIANGLE = `solid t
facet normal 0 0 1
outer loop
vertex 0 0 0
vertex 10 0 0
vertex 0 10 0
endloop
endfacet
endsolid t
`;

function fakeWorker() {
  const posted: File[] = [];
  let terminated = 0;
  const worker: ParseWorker = {
    onmessage: null,
    onerror: null,
    postMessage: (file) => posted.push(file),
    terminate: () => {
      terminated++;
    },
  };
  return { worker, posted, terminated: () => terminated };
}

const file = new File([TRIANGLE], "t.stl");
const reply: ParsedStl = { position: new Float32Array(9), normal: new Float32Array(9), radius: 7 };

describe("parseStl", () => {
  test("posts the file to a worker, resolves its reply, then terminates it", async () => {
    const fake = fakeWorker();
    const result = parseStl(file, undefined, () => fake.worker);
    expect(fake.posted).toEqual([file]);
    fake.worker.onmessage?.(new MessageEvent("message", { data: reply }));
    expect(await result).toBe(reply);
    expect(fake.terminated()).toBe(1);
  });

  test("an abort terminates the worker and resolves null", async () => {
    const fake = fakeWorker();
    const controller = new AbortController();
    const result = parseStl(file, controller.signal, () => fake.worker);
    controller.abort();
    expect(await result).toBeNull();
    expect(fake.terminated()).toBe(1);
    expect(fake.worker.onmessage).toBeNull();
  });

  test("a worker error resolves null", async () => {
    const fake = fakeWorker();
    const result = parseStl(file, undefined, () => fake.worker);
    fake.worker.onerror?.(new ErrorEvent("error"));
    expect(await result).toBeNull();
    expect(fake.terminated()).toBe(1);
  });

  test("an already aborted signal never starts a worker", async () => {
    const controller = new AbortController();
    controller.abort();
    let spawned = 0;
    const result = parseStl(file, controller.signal, () => {
      spawned++;
      return fakeWorker().worker;
    });
    expect(await result).toBeNull();
    expect(spawned).toBe(0);
  });
});
