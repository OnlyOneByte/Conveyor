import { describe, expect, test } from "bun:test";
import { get, writable } from "svelte/store";
import { announce, announcements, announcer } from "./announce.js";

const fresh = () => {
  const regions = { polite: writable(""), assertive: writable("") };
  return { regions, say: announcer(regions) };
};

describe("announce", () => {
  test("writes the message to the region for its politeness, polite by default", async () => {
    const { regions, say } = fresh();
    await say("Bin 1×1 moved to Send on Voron 2.4.");
    await say("Bin 1×1 failed.", "assertive");
    expect(get(regions.polite)).toBe("Bin 1×1 moved to Send on Voron 2.4.");
    expect(get(regions.assertive)).toBe("Bin 1×1 failed.");
  });

  test("clears the region first, so the same message is announced again", async () => {
    const { regions, say } = fresh();
    const seen: string[] = [];
    const stop = regions.polite.subscribe((v) => seen.push(v));
    await say("Printed.");
    await say("Printed.");
    stop();
    expect(seen).toEqual(["", "Printed.", "", "Printed."]);
  });

  test("leaves the region empty for longer than a frame before refilling it", async () => {
    const { regions, say } = fresh();
    const done = say("Printed.");
    await new Promise((r) => setTimeout(r, 20));
    expect(get(regions.polite)).toBe("");
    await done;
    expect(get(regions.polite)).toBe("Printed.");
  });

  test("the app's announce speaks through the page's live regions", async () => {
    await announce("Bin 1×1 failed.", "assertive");
    expect(get(announcements.assertive)).toBe("Bin 1×1 failed.");
  });
});
