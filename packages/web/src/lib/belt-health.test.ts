import { describe, expect, test } from "bun:test";
import { rig, view } from "../../test/helpers/belt";
import { COVERED_MS, createTicker, FAILS_TO_CLEAR, POLL_MS } from "./belt";
import { chipName, groupName, OFFLINE } from "./track";

describe("the belt's live feed", () => {
  test("names jobs from their settings and printers by name, so two bins differ and no id shows", async () => {
    const { state, shown, told, belt } = rig();
    state.active = [
      view("a", "slicing"),
      view("b", "slicing", { generator: { id: "gridfinity", params: { gridX: 1, gridY: 1 } } }),
      view("c", "printing", {
        generator: { id: "passthrough", params: { uploadId: "u1", filename: "cable-clip.stl" } },
        printerId: "garage-1",
      }),
    ];
    await belt.poll();
    const jobs = shown.at(-1) ?? [];
    expect(jobs.map((job) => [job.name, job.printer])).toEqual([
      ["Gridfinity Bin 2×3 · 6u", "Voron 2.4"],
      ["Gridfinity Bin 1×1", "Voron 2.4"],
      ["cable-clip.stl", undefined],
    ]);
    state.active = [];
    for (const [jobId, end] of [
      ["a", "failed"],
      ["b", "failed"],
      ["c", "done"],
    ] as const)
      state.final.set(jobId, { jobId, state: end, at: 2 });
    await belt.poll();
    const spoken = [...jobs.map(chipName), groupName(jobs), ...told.map((news) => news.text)].join(
      " | ",
    );
    expect(told.map((news) => news.text)).toEqual([
      "Bin 2×3 · 6u failed",
      "Bin 1×1 failed",
      "cable-clip.stl finished",
    ]);
    for (const id of ["voron", "garage-1", "gridfinity", "passthrough"])
      expect(spoken).not.toContain(id);
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
    expect([shown.at(-1)?.map((job) => job.id), offline.at(-1), sockets.get("a")?.closed]).toEqual([
      ["a"],
      true,
      true,
    ]);
    expect(told).toEqual([
      { level: "polite", text: `${OFFLINE}. The belt shows the last jobs it saw` },
    ]);
    await belt.poll();
    expect(told).toHaveLength(1);
    state.active = [view("a", "printing")];
    await belt.poll();
    expect([shown.at(-1)?.map((job) => job.state), offline.at(-1)]).toEqual([["printing"], false]);
    expect(told.slice(1).map((news) => news.text)).toEqual([
      "Conveyor is back",
      "Bin 2×3 · 6u started printing on Voron 2.4 at 14:05",
    ]);
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
    const tick = createTicker(
      {
        poll: () =>
          new Promise<void>((done) => {
            polls.push(at);
            finish = done;
          }),
        covered: () => covered,
      },
      () => ready,
      () => at,
    );
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
