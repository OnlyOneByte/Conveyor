import { describe, expect, test } from "bun:test";
import { catalog, job, NOW, request } from "../../test/helpers/belt-ends";
import { createEnds } from "./belt-ends";
import { BURST_MS, changes, createNewsDesk } from "./belt-news";
import type { TrackJob } from "./track";
import { createToasts } from "./ui/behaviour";

describe("a cancel from the belt", () => {
  function shell(refuse: string[] = []) {
    const said: string[] = [];
    const timers: (() => void)[] = [];
    const toasted = new Set<string>();
    const toasts = createToasts({ after: () => () => {}, now: () => 0 }, (text) => said.push(text));
    const cancel = async (id: string) => {
      if (refuse.includes(id)) throw new Error("409");
    };
    const feed = {
      finished: async () => 0,
      needsYou: async () => [],
      entry: async () => null,
      submit: async () => ({}),
      retry: async () => ({ ok: true as const, jobId: "x" }),
      dismiss: async () => ({}),
      cancel,
      catalog: async () => catalog,
    };
    const ends = createEnds(
      feed,
      {
        show: () => {},
        toast: (text, action) => toasts.show(text, action),
        say: (text) => said.push(text),
        pick: () => {},
      },
      { now: () => NOW, toasted },
    );
    const desk = createNewsDesk(
      (text) => said.push(text),
      (run, ms) => ms === BURST_MS && timers.push(run),
      toasted,
    );
    const settle = (id: string, state: TrackJob["state"] = "canceled") => {
      desk(
        changes(
          new Map([[id, { ...job, id, state: "printing" }]]),
          [{ ...job, id, state }],
          "14:05",
        ),
      );
      for (const run of timers.splice(0)) run();
    };
    return { said, ends, settle, toasted };
  }

  test("is announced once, by its toast, when the belt then sees the job canceled", async () => {
    const { said, ends, settle } = shell();
    await ends.act({ ...job, id: "c1", state: "printing", request }, "Cancel");
    settle("c1");
    expect(said).toEqual(["Bin 2×3 canceled"]);
  });

  test("leaves a cancel from elsewhere, or one that failed here, to the belt", async () => {
    const { said, ends, settle } = shell(["c2"]);
    settle("c9");
    await ends.act({ ...job, id: "c2", state: "printing", request }, "Cancel");
    settle("c2");
    expect(said).toEqual([
      "Bin 2×3 was canceled.",
      "Couldn't cancel Bin 2×3.",
      "Bin 2×3 was canceled.",
    ]);
  });

  test("forgets the job once it ends another way, so a later cancel of it is announced", async () => {
    const { said, ends, settle, toasted } = shell();
    await ends.act({ ...job, id: "c3", state: "printing", request }, "Cancel");
    settle("c3", "done");
    expect(toasted.size).toBe(0);
    settle("c3");
    expect(said).toEqual([
      "Bin 2×3 canceled",
      "Bin 2×3 finished on Voron 2.4.",
      "Bin 2×3 was canceled.",
    ]);
  });
});
