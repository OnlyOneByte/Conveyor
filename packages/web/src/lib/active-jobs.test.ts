import { beforeEach, describe, expect, test } from "bun:test";
import type { JobView } from "@conveyor/shared";
import { get } from "svelte/store";
import { activeJobs, shareActive } from "./active-jobs";

const view = (jobId: string): JobView => ({ jobId, state: "printing", at: 1 });

describe("the shared active-jobs store", () => {
  beforeEach(() => {
    activeJobs.set(null);
  });

  test("a good answer is shared as ok; a failed one keeps the last jobs, says not ok and rethrows; the next good one recovers", async () => {
    let answer: JobView[] | Error = [view("a"), view("b")];
    const fetchJobs = shareActive(async () => {
      if (answer instanceof Error) throw answer;
      return answer;
    });
    expect(get(activeJobs)).toBeNull();
    expect(await fetchJobs()).toEqual([view("a"), view("b")]);
    expect(get(activeJobs)).toEqual({ jobs: [view("a"), view("b")], ok: true });
    answer = new Error("GET /jobs/active 503");
    await expect(fetchJobs()).rejects.toThrow("GET /jobs/active 503");
    expect(get(activeJobs)).toEqual({ jobs: [view("a"), view("b")], ok: false });
    answer = [view("c")];
    await fetchJobs();
    expect(get(activeJobs)).toEqual({ jobs: [view("c")], ok: true });
  });

  test("a failure before any answer shares no jobs and not ok", async () => {
    await expect(shareActive(async () => Promise.reject(new Error("down")))()).rejects.toThrow("down");
    expect(get(activeJobs)).toEqual({ jobs: [], ok: false });
  });
});
