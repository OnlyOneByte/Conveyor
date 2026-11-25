import { expect, test } from "bun:test";
import { get } from "svelte/store";
import { Unreachable } from "./http-error.js";
import { printJob } from "./print-job.js";
import { AlreadyRetried } from "./rerun.js";

const request = { generator: { id: "gridfinity", params: {} }, printerId: "p1", profileId: "pr1" };

test("a sent job lands on its page, clears the failure and names the printer", async () => {
  const went: string[] = [];
  let calls = 0;
  const job = printJob(
    async (to) => went.push(to),
    async () => {
      calls += 1;
      if (calls === 1) throw new Error("POST /jobs 502");
      return { jobId: "j 1" };
    },
  );
  await job.run(request, undefined, "Bin", "Neptune");
  expect(get(job).error).not.toBeNull();
  await job.run(request, undefined, "Bin", "Neptune");
  expect(went).toEqual(["/?job=j%201"]);
  expect(get(job)).toMatchObject({
    busy: false,
    sent: true,
    error: null,
    last: { id: "j 1", printer: "Neptune" },
  });
});

test("each failure counts up, keeps the raw reason and leaves the job unsent", async () => {
  const job = printJob(
    async () => undefined,
    async () => {
      throw new Unreachable("POST /jobs 502");
    },
  );
  await job.run(request, undefined, "Bin", "Neptune");
  await job.run(request, undefined, "Bin", "Neptune");
  expect(get(job)).toMatchObject({
    busy: false,
    sent: false,
    attempt: 2,
    why: "POST /jobs 502",
    last: null,
  });
});

test("an already-retried job points at the retry", async () => {
  const job = printJob(
    async () => undefined,
    async () => {
      throw new AlreadyRetried("j2");
    },
  );
  await job.run(request, "j0", "Bin", "Neptune");
  expect(get(job).retried).toBe("j2");
});

test("it is busy while the send is in flight", async () => {
  let release = () => {};
  const job = printJob(
    async () => undefined,
    () => new Promise((done) => (release = () => done({ jobId: "j3" }))),
  );
  const sending = job.run(request, undefined, "Bin", "Neptune");
  expect(get(job).busy).toBe(true);
  release();
  await sending;
  expect(get(job).busy).toBe(false);
});

test("a second run while one send is in flight sends nothing", async () => {
  const releases: (() => void)[] = [];
  const job = printJob(
    async () => undefined,
    () => new Promise((done) => releases.push(() => done({ jobId: "j4" }))),
  );
  const first = job.run(request, undefined, "Bin", "Neptune");
  const second = job.run(request, undefined, "Bin", "Neptune");
  for (const release of releases) release();
  expect(await Promise.all([first, second])).toEqual([true, false]);
  expect(releases).toHaveLength(1);
});
