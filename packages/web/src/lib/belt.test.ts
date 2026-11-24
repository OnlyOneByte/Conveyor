import { describe, expect, test } from "bun:test";
import type { JobStatusEvent, JobView } from "@conveyor/shared";
import { createBelt, FAILS_TO_CLEAR, type Feed, MAX_SOCKETS, POLL_MS, type Socket, trackJob } from "./belt";
import type { News } from "./belt-news";
import type { Catalog } from "./catalog";
import { chipName, groupName, type TrackJob } from "./track";

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
  const belt = createBelt(feed, (jobs) => shown.push(jobs), (news) => told.push(...news));
  const send = (event: JobStatusEvent, to = event.jobId) => sockets.get(to)?.onmessage?.(new MessageEvent("message", { data: JSON.stringify(event) }));
  return { state, sockets, shown, told, belt, send };
}

describe("the belt's live feed", () => {
  test("polls every 2 s, and shows the active jobs with their names and printers, saying nothing on the first look", async () => {
    expect([POLL_MS, MAX_SOCKETS]).toEqual([2000, 10]);
    const { state, shown, told, belt } = rig();
    state.active = [view("a", "printing", { progress: 0.4 }), view("b", "queued", { generator: undefined })];
    await belt.poll();
    expect(shown.at(-1)).toEqual([
      { id: "a", name: "Gridfinity Bin 2x3 · 6u", state: "printing", progress: 0.4, printer: "Voron 2.4" },
      { id: "b", name: "Job", state: "queued", printer: "Voron 2.4" },
    ]);
    expect(told).toEqual([]);
  });

  test("a job that leaves the list is announced from its final state, or as gone if that can't be read", async () => {
    const { state, shown, told, belt } = rig();
    state.active = [view("a", "printing"), view("b", "slicing"), view("c", "printing")];
    await belt.poll();
    state.active = [];
    state.final.set("a", { jobId: "a", state: "done", at: 2, generator: { id: "gridfinity", params: {} } });
    state.final.set("b", { jobId: "b", state: "failed", at: 2, error: { stage: "slicer", reason: "no profile." } });
    state.final.set("c", new Error("offline"));
    await belt.poll();
    expect(told).toEqual([
      { level: "polite", text: "Bin 2x3 · 6u finished on Voron 2.4" },
      { level: "assertive", text: "Bin 2x3 · 6u failed: no profile" },
      { level: "polite", text: "Bin 2x3 · 6u left the belt; its job page has how it ended" },
    ]);
    expect(shown.at(-1)).toEqual([]);
    await belt.poll();
    expect(told).toHaveLength(3);
  });

  test("a socket per rail chip, at most 10, carries moves; a socket job isn't overwritten by a poll", async () => {
    const { state, sockets, shown, told, belt, send } = rig();
    state.active = [view("q", "queued"), ...Array.from({ length: 12 }, (_, i) => view(`r${i}`, "slicing", { progress: 0.1 }))];
    await belt.poll();
    expect([sockets.size, sockets.has("q")]).toEqual([MAX_SOCKETS, false]);
    send({ jobId: "r1", state: "done", at: 3 }, "r0");
    send({ jobId: "r0", state: "transferring", progress: 0.5, at: 3 });
    expect(told).toEqual([{ level: "polite", text: "Bin 2x3 · 6u moved to Send on Voron 2.4" }]);
    send({ jobId: "r1", state: "queued", at: 3 });
    expect([sockets.get("r1")?.closed, told.length]).toEqual([true, 1]);
    state.active = state.active.map((job) => (job.jobId === "r1" ? view("r1", "queued") : job));
    state.catalog = { ...catalog, printers: [{ id: "voron", name: "Voron Trident", transportId: "klipper", address: "192.0.2.9", hasSecrets: false }] };
    await belt.poll();
    expect(shown.at(-1)?.find((job) => job.id === "r0")).toMatchObject({ state: "transferring", progress: 0.5, printer: "Voron Trident" });
    send({ jobId: "r0", state: "done", at: 4 });
    expect([told.at(-1)?.text, sockets.get("r0")?.closed, shown.at(-1)?.some((job) => job.id === "r0")]).toEqual(["Bin 2x3 · 6u finished on Voron Trident", true, false]);
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
    expect(told).toEqual([{ level: "polite", text: "Bin 2x3 · 6u moved to Send on Voron 2.4" }]);
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
    const was: TrackJob = { id: "a", name: "Gridfinity Bin 2x3", state: "slicing", printer: "Voron 2.4" };
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
    expect(jobs.map((job) => [job.name, job.printer])).toEqual([["Gridfinity Bin 2x3 · 6u", "Voron 2.4"], ["Gridfinity Bin 1x1", "Voron 2.4"], ["cable-clip.stl", undefined]]);
    state.active = [];
    for (const [jobId, end] of [["a", "failed"], ["b", "failed"], ["c", "done"]] as const) state.final.set(jobId, { jobId, state: end, at: 2 });
    await belt.poll();
    const spoken = [...jobs.map(chipName), groupName(jobs), ...told.map((news) => news.text)].join(" | ");
    expect(told.map((news) => news.text)).toEqual(["Bin 2x3 · 6u failed", "Bin 1x1 failed", "cable-clip.stl finished"]);
    for (const id of ["voron", "garage-1", "gridfinity", "passthrough"]) expect(spoken).not.toContain(id);
    state.catalog = null;
    state.active = [view("d", "slicing")];
    await belt.poll();
    expect(shown.at(-1)?.[0]?.printer).toBeUndefined();
  });

  test("a failing poll clears the belt and says so once; a single failure keeps it", async () => {
    const { state, shown, told, sockets, belt } = rig();
    state.active = [view("a", "slicing")];
    await belt.poll();
    state.active = null;
    await belt.poll();
    expect([FAILS_TO_CLEAR, shown.at(-1)?.length, told]).toEqual([2, 1, []]);
    await belt.poll();
    expect([shown.at(-1), sockets.get("a")?.closed]).toEqual([[], true]);
    expect(told).toEqual([{ level: "polite", text: "The belt can't reach the server, so its jobs are hidden until it can" }]);
    state.active = [view("a", "slicing")];
    await belt.poll();
    state.active = null;
    await belt.poll();
    expect([shown.at(-1)?.length, told.length]).toEqual([1, 1]);
  });

});
