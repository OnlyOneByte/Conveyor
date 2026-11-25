import { describe, expect, test } from "bun:test";
import type { JobView } from "@conveyor/shared";
import { createBelt, createTicker, type Feed, type Socket } from "./belt";
import type { News } from "./belt-news";
import type { TrackJob } from "./track";

const printing = (jobId: string): JobView => ({ jobId, state: "printing", at: 1, printerId: "voron" });

function held() {
  const answers: Promise<JobView[]>[] = [];
  const release: ((jobs: JobView[]) => void)[] = [];
  const hold = () => answers.push(new Promise<JobView[]>((done) => release.push(done)));
  return { answers, release, hold };
}

function rig() {
  const queue = held();
  let now: JobView[] = [];
  const final = new Map<string, JobView>();
  const ended: TrackJob[] = [];
  const told: News[] = [];
  const socket = (): Socket => ({ onmessage: null, onclose: null, close: () => {} });
  const feed: Feed = {
    active: async () => queue.answers.shift() ?? now,
    final: async (id) => final.get(id) ?? null,
    socket,
    catalog: async () => ({ printers: [], generators: [] }),
    clock: () => "14:05",
  };
  const belt = createBelt(feed, (_, gone) => ended.push(...gone), (news) => told.push(...news));
  const set = (jobs: JobView[]) => (now = jobs);
  return { belt, queue, final, ended, told, set };
}

const settle = () => new Promise((done) => setTimeout(done, 10));

describe("the belt's ticker", () => {
  test("a forced tick skips the covered wait, but queues behind a poll in flight", async () => {
    let finish = () => {};
    const polls: number[] = [];
    const poll = () => new Promise<void>((done) => (polls.push(polls.length), (finish = done)));
    const tick = createTicker({ poll, covered: () => true }, () => true, () => 0);
    tick();
    tick.force();
    tick.force();
    expect(polls).toEqual([0]);
    finish();
    await settle();
    expect(polls).toEqual([0, 1]);
    finish();
    await settle();
    tick.force();
    expect(polls).toEqual([0, 1, 2]);
  });

  test("a job-sent poll during a ticker poll can't bring an ended job back with an older answer", async () => {
    const { belt, queue, final, ended, told, set } = rig();
    set([printing("x")]);
    await belt.poll();
    final.set("x", { jobId: "x", state: "done", at: 2 });
    queue.hold();
    queue.hold();
    const tick = createTicker(belt, () => true);
    tick();
    tick.force();
    queue.release[1]?.([]);
    await settle();
    queue.release[0]?.([printing("x")]);
    await settle();
    set([]);
    await belt.poll();
    expect(ended.filter((job) => job.id === "x")).toHaveLength(1);
    expect(told.filter((news) => news.ended === "x")).toHaveLength(1);
  });
});
