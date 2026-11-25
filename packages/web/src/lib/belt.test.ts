import { describe, expect, test } from "bun:test";
import { catalog, rig, view } from "../../test/helpers/belt";
import { MAX_SOCKETS, POLL_MS, trackJob } from "./belt";
import type { TrackJob } from "./track";

describe("the belt's live feed", () => {
  test("polls every 2 s, and shows the active jobs with their names and printers, saying nothing on the first look", async () => {
    expect([POLL_MS, MAX_SOCKETS]).toEqual([2000, 10]);
    const { state, shown, told, belt } = rig();
    state.active = [
      view("a", "printing", { progress: 0.4 }),
      view("b", "queued", { generator: undefined }),
    ];
    await belt.poll();
    expect(shown.at(-1)).toEqual([
      {
        id: "a",
        name: "Gridfinity Bin 2×3 · 6u",
        state: "printing",
        progress: 0.4,
        printer: "Voron 2.4",
        request: {
          generator: { id: "gridfinity", params: { gridX: 2, gridY: 3, heightUnits: 6 } },
          printerId: "voron",
          profileId: "pla",
        },
      },
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
    state.final.set("a", {
      jobId: "a",
      state: "done",
      at: 2,
      generator: { id: "gridfinity", params: {} },
    });
    state.final.set("b", {
      jobId: "b",
      state: "failed",
      at: 2,
      error: { stage: "slicer", reason: "no profile." },
    });
    state.final.set("c", new Error("offline"));
    await belt.poll();
    expect(told).toEqual([
      { level: "polite", text: "Bin 2×3 · 6u finished on Voron 2.4", ended: "a" },
      { level: "assertive", text: "Bin 2×3 · 6u failed: no profile", ended: "b" },
      {
        level: "polite",
        text: "Bin 2×3 · 6u left the belt; its job page has how it ended",
        ended: "c",
      },
    ]);
    expect(shown.at(-1)).toEqual([]);
    expect(ended.at(-1)?.map((job) => [job.id, job.state])).toEqual([
      ["a", "done"],
      ["b", "failed"],
    ]);
    await belt.poll();
    expect(told).toHaveLength(3);
    expect(ended.at(-1)).toEqual([]);
  });

  test("a socket per rail chip, at most 10, carries moves; a socket job isn't overwritten by a poll", async () => {
    const { state, sockets, shown, told, belt, send } = rig();
    state.active = [
      view("q", "queued"),
      ...Array.from({ length: 12 }, (_, i) => view(`r${i}`, "slicing", { progress: 0.1 })),
    ];
    await belt.poll();
    expect([sockets.size, sockets.has("q")]).toEqual([MAX_SOCKETS, false]);
    send({ jobId: "r1", state: "done", at: 3 }, "r0");
    send({ jobId: "r0", state: "transferring", progress: 0.5, at: 3 });
    expect(told).toEqual([{ level: "polite", text: "Bin 2×3 · 6u moved to Send on Voron 2.4" }]);
    send({ jobId: "r1", state: "queued", at: 3 });
    expect([sockets.get("r1")?.closed, told.length]).toEqual([true, 1]);
    state.active = state.active.map((job) => (job.jobId === "r1" ? view("r1", "queued") : job));
    state.catalog = {
      ...catalog,
      printers: [
        {
          id: "voron",
          name: "Voron Trident",
          transportId: "klipper",
          address: "192.0.2.9",
          hasSecrets: false,
        },
      ],
    };
    await belt.poll();
    expect(shown.at(-1)?.find((job) => job.id === "r0")).toMatchObject({
      state: "transferring",
      progress: 0.5,
      printer: "Voron Trident",
    });
    send({ jobId: "r0", state: "done", at: 4 });
    expect([
      told.at(-1)?.text,
      sockets.get("r0")?.closed,
      shown.at(-1)?.some((job) => job.id === "r0"),
    ]).toEqual(["Bin 2×3 · 6u finished on Voron Trident", true, false]);
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
    expect([request, shown.at(-1)?.[0]?.request]).toEqual([
      {
        generator: { id: "gridfinity", params: { gridX: 2, gridY: 3, heightUnits: 6 } },
        printerId: "voron",
        profileId: "pla",
      },
      request,
    ]);
  });

  test("a status event keeps the name and printer it had", () => {
    const was: TrackJob = {
      id: "a",
      name: "Gridfinity Bin 2×3",
      state: "slicing",
      printer: "Voron 2.4",
    };
    expect(trackJob({ jobId: "a", state: "failed", error: { reason: "x" } }, was)).toEqual({
      ...was,
      state: "failed",
      reason: "x",
    });
  });
});
