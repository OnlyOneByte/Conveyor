import { beforeEach, describe, expect, test } from "bun:test";
import type { JobView } from "@conveyor/shared";
import { get } from "svelte/store";
import { activeJobs, shareActive, unwatched, watchActive, watchers } from "./active-jobs";

const view = (jobId: string): JobView => ({ jobId, state: "printing", at: 1 });

describe("the shared active-jobs store", () => {
  beforeEach(() => {
    activeJobs.set(null);
    watchers.set(0);
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

  test("the poll may back off only while sockets cover the belt and no page is watching", () => {
    let covered = true;
    const mayBackOff = unwatched(() => covered);
    expect(mayBackOff()).toBe(true);
    const stop = watchActive();
    const stopAnother = watchActive();
    expect(mayBackOff()).toBe(false);
    stop();
    expect(mayBackOff()).toBe(false);
    stopAnother();
    expect(mayBackOff()).toBe(true);
    covered = false;
    expect(mayBackOff()).toBe(false);
  });
});
