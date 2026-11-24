import { describe, expect, test } from "bun:test";
import type { JobStatusEvent, JobView } from "@conveyor/shared";
import { createBelt, type Feed, MAX_SOCKETS, POLL_MS, type Socket, trackJob } from "./belt";
import type { News } from "./belt-news";
import type { TrackJob } from "./track";

const view = (jobId: string, state: JobView["state"], extra: Partial<JobView> = {}): JobView => ({
  jobId,
  state,
  at: 1,
  printerId: "voron",
  profileId: "pla",
  generator: { id: "gridfinity", params: {} },
  createdAt: 1,
  ...extra,
});

function rig() {
  const state = { active: [] as JobView[], final: new Map<string, JobStatusEvent>() };
  const sockets = new Map<string, Socket & { closed: boolean }>();
  const shown: TrackJob[][] = [];
  const told: News[] = [];
  const feed: Feed = {
    active: async () => state.active,
    final: async (id) => state.final.get(id) ?? null,
    socket: (id) => {
      const socket: Socket & { closed: boolean } = { onmessage: null, onclose: null, closed: false, close: () => (socket.closed = true) };
      sockets.set(id, socket);
      return socket;
    },
    clock: () => "14:05",
  };
  const belt = createBelt(feed, (jobs) => shown.push(jobs), (news) => told.push(...news));
  const send = (event: JobStatusEvent, to = event.jobId) => sockets.get(to)?.onmessage?.(new MessageEvent("message", { data: JSON.stringify(event) }));
  return { state, sockets, shown, told, belt, send };
}

describe("the belt's live feed", () => {
  test("polls every 2 s and opens at most 10 sockets", () => {
    expect([POLL_MS, MAX_SOCKETS]).toEqual([2000, 10]);
  });

  test("shows the active jobs with their generator and printer, and says nothing on the first look", async () => {
    const { state, shown, told, belt } = rig();
    state.active = [view("a", "printing", { progress: 0.4 }), view("b", "queued", { generator: undefined })];
    await belt.poll();
    expect(shown.at(-1)).toEqual([
      { id: "a", name: "Gridfinity", state: "printing", progress: 0.4, printer: "voron" },
      { id: "b", name: "Job", state: "queued", printer: "voron" },
    ]);
    expect(told).toEqual([]);
  });

  test("a job that leaves the list is announced from its final state, then dropped", async () => {
    const { state, shown, told, belt } = rig();
    state.active = [view("a", "printing"), view("b", "slicing"), view("c", "printing")];
    await belt.poll();
    state.active = [];
    state.final.set("a", { jobId: "a", state: "done", at: 2 });
    state.final.set("b", { jobId: "b", state: "failed", at: 2, error: { stage: "slicer", reason: "no profile." } });
    await belt.poll();
    expect(told).toEqual([
      { level: "polite", text: "Gridfinity finished on voron" },
      { level: "assertive", text: "Gridfinity failed: no profile" },
    ]);
    expect(shown.at(-1)).toEqual([]);
    await belt.poll();
    expect(told).toHaveLength(2);
  });

  test("a socket per rail chip, at most 10, carries moves; a socket job isn't overwritten by a poll", async () => {
    const { state, sockets, shown, told, belt, send } = rig();
    state.active = [view("q", "queued"), ...Array.from({ length: 12 }, (_, i) => view(`r${i}`, "slicing", { progress: 0.1 }))];
    await belt.poll();
    expect([sockets.size, sockets.has("q")]).toEqual([MAX_SOCKETS, false]);
    send({ jobId: "r1", state: "done", at: 3 }, "r0");
    send({ jobId: "r0", state: "transferring", progress: 0.5, at: 3 });
    expect(told).toEqual([{ level: "polite", text: "Gridfinity moved to Send on voron" }]);
    send({ jobId: "r1", state: "queued", at: 3 });
    expect([sockets.get("r1")?.closed, told.length]).toEqual([true, 1]);
    state.active = state.active.map((job) => (job.jobId === "r1" ? view("r1", "queued") : job));
    await belt.poll();
    expect(shown.at(-1)?.find((job) => job.id === "r0")).toMatchObject({ state: "transferring", progress: 0.5 });
    send({ jobId: "r0", state: "done", at: 4 });
    expect([told.at(-1)?.text, sockets.get("r0")?.closed, shown.at(-1)?.some((job) => job.id === "r0")]).toEqual(["Gridfinity finished on voron", true, false]);
    state.active = state.active.filter((job) => job.jobId !== "r0");
    await belt.poll();
    expect([told.length, sockets.get("r0")?.closed, sockets.has("r10")]).toEqual([2, true, true]);
  });

  test("a socket that closes hands its job back to the poll", async () => {
    const { state, sockets, told, belt } = rig();
    state.active = [view("a", "slicing")];
    await belt.poll();
    sockets.get("a")?.onclose?.(new CloseEvent("close"));
    state.active = [view("a", "transferring")];
    await belt.poll();
    expect(told).toEqual([{ level: "polite", text: "Gridfinity moved to Send on voron" }]);
  });

  test("a job with no final state is dropped silently, and stop closes every socket", async () => {
    const { state, sockets, told, belt } = rig();
    state.active = [view("a", "printing")];
    await belt.poll();
    state.active = [];
    await belt.poll();
    expect([told, sockets.get("a")?.closed]).toEqual([[], true]);
    state.active = [view("b", "printing")];
    await belt.poll();
    belt.stop();
    expect(sockets.get("b")?.closed).toBe(true);
  });

  test("a status event keeps the name and printer it had", () => {
    const was: TrackJob = { id: "a", name: "Gridfinity", state: "slicing", printer: "voron" };
    expect(trackJob({ jobId: "a", state: "failed", error: { reason: "x" } }, was)).toEqual({ id: "a", name: "Gridfinity", state: "failed", printer: "voron", reason: "x" });
  });
});
