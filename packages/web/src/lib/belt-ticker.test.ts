import { describe, expect, test } from "bun:test";
import type { JobStatusEvent, JobView } from "@conveyor/shared";
import { createBelt, createTicker, type Feed, type Socket } from "./belt";
import type { News } from "./belt-news";
import type { TrackJob } from "./track";

const printing = (jobId: string): JobView => ({ jobId, state: "printing", at: 1, printerId: "voron" });

function held() {
  const answers: Promise<JobView[]>[] = [];
  const release: ((jobs: JobView[]) => void)[] = [];
  const fail: ((error: Error) => void)[] = [];
  const hold = () =>
    answers.push(new Promise<JobView[]>((done, refuse) => (release.push(done), fail.push(refuse))));
  return { answers, release, fail, hold };
}

function rig() {
  const queue = held();
  let now: JobView[] = [];
  const final = new Map<string, JobView>();
  const ended: TrackJob[] = [];
  const told: News[] = [];
  const offline: boolean[] = [];
  const sockets = new Map<string, Socket>();
  const socket = (id: string): Socket => {
    const made: Socket = { onmessage: null, onclose: null, close: () => {} };
    sockets.set(id, made);
    return made;
  };
  const send = (event: JobStatusEvent) => {
    const data = JSON.stringify(event);
    sockets.get(event.jobId)?.onmessage?.(new MessageEvent("message", { data }));
  };
  const feed: Feed = {
    active: async () => queue.answers.shift() ?? now,
    final: async (id) => final.get(id) ?? null,
    socket,
    catalog: async () => ({ printers: [], generators: [] }),
    clock: () => "14:05",
  };
  const belt = createBelt(feed, (_, gone, down) => (ended.push(...gone), offline.push(down)), (news) => told.push(...news));
  const set = (jobs: JobView[]) => (now = jobs);
  return { belt, queue, final, ended, told, offline, set, send };
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

  test("the belt drops an answer older than one it already applied, whoever polls", async () => {
    const { belt, queue, final, ended, told, set } = rig();
    set([printing("x")]);
    await belt.poll();
    final.set("x", { jobId: "x", state: "done", at: 2 });
    queue.hold();
    queue.hold();
    const first = belt.poll();
    const second = belt.poll();
    queue.release[1]?.([]);
    await second;
    queue.release[0]?.([printing("x")]);
    await first;
    set([]);
    await belt.poll();
    expect(ended.filter((job) => job.id === "x")).toHaveLength(1);
    expect(told.filter((news) => news.ended === "x")).toHaveLength(1);
  });

  test("a stale failure plus one new failure doesn't take the belt offline", async () => {
    const { belt, queue, told, offline, set } = rig();
    set([printing("x")]);
    await belt.poll();
    queue.hold();
    const failed = belt.poll();
    queue.fail[0]?.(new Error("down"));
    await failed;
    queue.hold();
    queue.hold();
    const first = belt.poll();
    const second = belt.poll();
    queue.release[2]?.([printing("x")]);
    await second;
    queue.fail[1]?.(new Error("late"));
    await first;
    queue.hold();
    const next = belt.poll();
    queue.fail[3]?.(new Error("down again"));
    await next;
    expect(offline).not.toContain(true);
    expect(told.map((news) => news.text)).not.toContain(expect.stringContaining("belt shows"));
  });

  test("a socket's done during a poll beats the poll's older answer", async () => {
    const { belt, queue, final, ended, told, set, send } = rig();
    set([printing("x")]);
    await belt.poll();
    final.set("x", { jobId: "x", state: "done", at: 2 });
    queue.hold();
    const late = belt.poll();
    send({ jobId: "x", state: "done", at: 2 });
    queue.release[0]?.([printing("x")]);
    await late;
    set([]);
    await belt.poll();
    expect(ended.filter((job) => job.id === "x")).toHaveLength(1);
    expect(told.filter((news) => news.ended === "x")).toHaveLength(1);
  });
});
