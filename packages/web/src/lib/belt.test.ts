import { describe, expect, test } from "bun:test";
import type { JobStatusEvent, JobView } from "@conveyor/shared";
import { COVERED_MS, createBelt, createTicker, FAILS_TO_CLEAR, type Feed, MAX_SOCKETS, POLL_MS, type Socket, trackJob } from "./belt";
import type { News } from "./belt-news";
import type { Catalog } from "./catalog";
import { chipName, groupName, OFFLINE, type TrackJob } from "./track";

const catalog: Catalog = {
  printers: [{ id: "voron", name: "Voron 2.4", transportId: "klipper", address: "192.0.2.9", hasSecrets: false }],
  generators: [{ id: "gridfinity", name: "Gridfinity Bin", outputs: [], paramSchema: { properties: { gridX: { type: "integer" }, gridY: { type: "integer" }, heightUnits: { type: "integer" } } }, ui: { groups: [{ title: "Footprint", fields: ["gridX", "gridY"], layout: "pair" }, { title: "Height", fields: ["heightUnits"], layout: "stack" }], unitMm: { heightUnits: 7 } } }],
};

const view = (jobId: string, state: JobView["state"], extra: Partial<JobView> = {}): JobView => ({
  jobId,
  state,
  at: 1,
  printerId: "voron",
  profileId: "pla",
  generator: { id: "gridfinity", params: { gridX: 2, gridY: 3, heightUnits: 6 } },
  createdAt: 1,
  ...extra,
});

function rig() {
  const state = { active: [] as JobView[] | null, final: new Map<string, JobView | Error>(), catalog: catalog as Catalog | null };
  const sockets = new Map<string, Socket & { closed: boolean }>();
  const shown: TrackJob[][] = [];
  const told: News[] = [];
  const feed: Feed = {
    active: async () => {
      if (!state.active) throw new Error("401");
      return state.active;
    },
    final: async (id) => {
      const found = state.final.get(id);
      if (found instanceof Error) throw found;
      return found ?? null;
    },
    catalog: async () => {
      if (!state.catalog) throw new Error("down");
      return state.catalog;
    },
    socket: (id) => {
      const socket: Socket & { closed: boolean } = { onmessage: null, onclose: null, closed: false, close: () => (socket.closed = true) };
      sockets.set(id, socket);
      return socket;
    },
    clock: () => "14:05",
  };
  const ended: TrackJob[][] = [];
  const offline: boolean[] = [];
  const belt = createBelt(feed, (jobs, gone, down) => (shown.push(jobs), ended.push(gone), offline.push(down)), (news) => told.push(...news));
  const send = (event: JobStatusEvent, to = event.jobId) => sockets.get(to)?.onmessage?.(new MessageEvent("message", { data: JSON.stringify(event) }));
  return { state, sockets, shown, ended, offline, told, belt, send };
}

describe("the belt's live feed", () => {
  test("polls every 2 s, and shows the active jobs with their names and printers, saying nothing on the first look", async () => {
    expect([POLL_MS, MAX_SOCKETS]).toEqual([2000, 10]);
    const { state, shown, told, belt } = rig();
    state.active = [view("a", "printing", { progress: 0.4 }), view("b", "queued", { generator: undefined })];
    await belt.poll();
    expect(shown.at(-1)).toEqual([
      { id: "a", name: "Gridfinity Bin 2×3 · 6u", state: "printing", progress: 0.4, printer: "Voron 2.4", request: { generator: { id: "gridfinity", params: { gridX: 2, gridY: 3, heightUnits: 6 } }, printerId: "voron", profileId: "pla" } },
      { id: "b", name: "Job", state: "queued", printer: "Voron 2.4" },
    ]);
    expect(told).toEqual([]);
  });

  test("a job that leaves the list is announced from its final state, or as gone if that can't be read", async () => {
    const { state, shown, ended, told, belt } = rig();
    state.active = [view("a", "printing"), view("b", "slicing"), view("c", "printing")];
    await belt.poll();
    expect(ended.at(-1)).toEqual([]);
    state.active = [];
    state.final.set("a", { jobId: "a", state: "done", at: 2, generator: { id: "gridfinity", params: {} } });
    state.final.set("b", { jobId: "b", state: "failed", at: 2, error: { stage: "slicer", reason: "no profile." } });
    state.final.set("c", new Error("offline"));
    await belt.poll();
    expect(told).toEqual([
      { level: "polite", text: "Bin 2×3 · 6u finished on Voron 2.4" },
      { level: "assertive", text: "Bin 2×3 · 6u failed: no profile" },
      { level: "polite", text: "Bin 2×3 · 6u left the belt; its job page has how it ended" },
    ]);
    expect(shown.at(-1)).toEqual([]);
    expect(ended.at(-1)?.map((job) => [job.id, job.state])).toEqual([["a", "done"], ["b", "failed"]]);
    await belt.poll();
    expect(told).toHaveLength(3);
    expect(ended.at(-1)).toEqual([]);
  });

  test("a socket per rail chip, at most 10, carries moves; a socket job isn't overwritten by a poll", async () => {
    const { state, sockets, shown, told, belt, send } = rig();
    state.active = [view("q", "queued"), ...Array.from({ length: 12 }, (_, i) => view(`r${i}`, "slicing", { progress: 0.1 }))];
    await belt.poll();
    expect([sockets.size, sockets.has("q")]).toEqual([MAX_SOCKETS, false]);
    send({ jobId: "r1", state: "done", at: 3 }, "r0");
    send({ jobId: "r0", state: "transferring", progress: 0.5, at: 3 });
    expect(told).toEqual([{ level: "polite", text: "Bin 2×3 · 6u moved to Send on Voron 2.4" }]);
    send({ jobId: "r1", state: "queued", at: 3 });
    expect([sockets.get("r1")?.closed, told.length]).toEqual([true, 1]);
    state.active = state.active.map((job) => (job.jobId === "r1" ? view("r1", "queued") : job));
    state.catalog = { ...catalog, printers: [{ id: "voron", name: "Voron Trident", transportId: "klipper", address: "192.0.2.9", hasSecrets: false }] };
    await belt.poll();
    expect(shown.at(-1)?.find((job) => job.id === "r0")).toMatchObject({ state: "transferring", progress: 0.5, printer: "Voron Trident" });
    send({ jobId: "r0", state: "done", at: 4 });
    expect([told.at(-1)?.text, sockets.get("r0")?.closed, shown.at(-1)?.some((job) => job.id === "r0")]).toEqual(["Bin 2×3 · 6u finished on Voron Trident", true, false]);
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
    expect(told).toEqual([{ level: "polite", text: "Bin 2×3 · 6u moved to Send on Voron 2.4" }]);
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

  test("a chip keeps its earlier request when a later active-jobs answer lacks one", async () => {
    const { state, shown, belt } = rig();
    state.active = [view("a", "queued")];
    await belt.poll();
    const request = shown.at(-1)?.[0]?.request;
    state.active = [view("a", "queued", { profileId: undefined, generator: undefined })];
    await belt.poll();
    expect([request, shown.at(-1)?.[0]?.request]).toEqual([{ generator: { id: "gridfinity", params: { gridX: 2, gridY: 3, heightUnits: 6 } }, printerId: "voron", profileId: "pla" }, request]);
  });

  test("a status event keeps the name and printer it had", () => {
    const was: TrackJob = { id: "a", name: "Gridfinity Bin 2×3", state: "slicing", printer: "Voron 2.4" };
    expect(trackJob({ jobId: "a", state: "failed", error: { reason: "x" } }, was)).toEqual({ ...was, state: "failed", reason: "x" });
  });

  test("names jobs from their settings and printers by name, so two bins differ and no id shows", async () => {
    const { state, shown, told, belt } = rig();
    state.active = [
      view("a", "slicing"),
      view("b", "slicing", { generator: { id: "gridfinity", params: { gridX: 1, gridY: 1 } } }),
      view("c", "printing", { generator: { id: "passthrough", params: { uploadId: "u1", filename: "cable-clip.stl" } }, printerId: "garage-1" }),
    ];
    await belt.poll();
    const jobs = shown.at(-1) ?? [];
    expect(jobs.map((job) => [job.name, job.printer])).toEqual([["Gridfinity Bin 2×3 · 6u", "Voron 2.4"], ["Gridfinity Bin 1×1", "Voron 2.4"], ["cable-clip.stl", undefined]]);
    state.active = [];
    for (const [jobId, end] of [["a", "failed"], ["b", "failed"], ["c", "done"]] as const) state.final.set(jobId, { jobId, state: end, at: 2 });
    await belt.poll();
    const spoken = [...jobs.map(chipName), groupName(jobs), ...told.map((news) => news.text)].join(" | ");
    expect(told.map((news) => news.text)).toEqual(["Bin 2×3 · 6u failed", "Bin 1×1 failed", "cable-clip.stl finished"]);
    for (const id of ["voron", "garage-1", "gridfinity", "passthrough"]) expect(spoken).not.toContain(id);
    state.catalog = null;
    state.active = [view("d", "slicing")];
    await belt.poll();
    expect(shown.at(-1)?.[0]?.printer).toBeUndefined();
  });

  test("ok, fail, fail goes offline with the last jobs kept and says so once; the next good poll recovers", async () => {
    const { state, shown, offline, told, sockets, belt } = rig();
    state.active = [view("a", "slicing")];
    await belt.poll();
    state.active = null;
    await belt.poll();
    expect([FAILS_TO_CLEAR, offline.at(-1), told]).toEqual([2, false, []]);
    await belt.poll();
    expect([shown.at(-1)?.map((job) => job.id), offline.at(-1), sockets.get("a")?.closed]).toEqual([["a"], true, true]);
    expect(told).toEqual([{ level: "polite", text: `${OFFLINE}. The belt shows the last jobs it saw.` }]);
    await belt.poll();
    expect(told).toHaveLength(1);
    state.active = [view("a", "printing")];
    await belt.poll();
    expect([shown.at(-1)?.map((job) => job.state), offline.at(-1)]).toEqual([["printing"], false]);
    expect(told.slice(1).map((news) => news.text)).toEqual(["Conveyor is back.", "Bin 2×3 · 6u started printing on Voron 2.4 at 14:05"]);
    state.active = null;
    await belt.poll();
    expect([offline.at(-1), told.length]).toEqual([false, 3]);
  });

  test("the belt is covered only while every job it knows is on the rail with a socket", async () => {
    const { state, sockets, belt } = rig();
    expect(belt.covered()).toBe(false);
    state.active = [view("a", "slicing"), view("b", "printing")];
    await belt.poll();
    expect(belt.covered()).toBe(true);
    sockets.get("b")?.onclose?.(new CloseEvent("close"));
    expect(belt.covered()).toBe(false);
    await belt.poll();
    expect(belt.covered()).toBe(true);
    state.active = [view("a", "slicing"), view("q", "queued")];
    await belt.poll();
    expect(belt.covered()).toBe(false);
  });

  test("the ticker polls every tick, backs off to 10 s while covered, and never overlaps or runs hidden", async () => {
    let at = 0;
    let covered = false;
    let ready = true;
    const polls: number[] = [];
    let finish = () => {};
    const tick = createTicker({ poll: () => new Promise<void>((done) => (polls.push(at), (finish = done))), covered: () => covered }, () => ready, () => at);
    tick();
    tick();
    expect(polls).toEqual([0]);
    finish();
    await Promise.resolve();
    at = POLL_MS;
    covered = true;
    tick();
    expect([COVERED_MS, polls]).toEqual([10_000, [0]]);
    at = COVERED_MS;
    tick();
    expect(polls).toEqual([0, COVERED_MS]);
    finish();
    await Promise.resolve();
    covered = false;
    at += POLL_MS;
    ready = false;
    tick();
    ready = true;
    tick();
    expect(polls).toEqual([0, COVERED_MS, COVERED_MS + POLL_MS]);
  });

});
