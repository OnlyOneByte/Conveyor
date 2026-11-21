import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import {
  buildMarkdown,
  isChanged,
  MARKER,
  manifestNotes,
  type Pair,
  pairUp,
  pixelDiff,
  readNotes,
} from "./compare.ts";
import { sampleFrames } from "./gif.ts";

function solid(width: number, height: number, rgb: [number, number, number]): Buffer {
  const png = new PNG({ width, height });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = rgb[0];
    png.data[i + 1] = rgb[1];
    png.data[i + 2] = rgb[2];
    png.data[i + 3] = 255;
  }
  return PNG.sync.write(png);
}

describe("pixelDiff", () => {
  test("identical images differ by 0", () => {
    expect(pixelDiff(solid(4, 4, [10, 10, 10]), solid(4, 4, [10, 10, 10]))).toBe(0);
  });
  test("small channel noise is ignored", () => {
    expect(pixelDiff(solid(4, 4, [10, 10, 10]), solid(4, 4, [20, 20, 20]))).toBe(0);
  });
  test("different colours differ fully", () => {
    expect(pixelDiff(solid(4, 4, [0, 0, 0]), solid(4, 4, [255, 0, 0]))).toBe(1);
  });
  test("different sizes count as fully changed", () => {
    expect(pixelDiff(solid(4, 4, [0, 0, 0]), solid(4, 5, [0, 0, 0]))).toBe(1);
  });
});

describe("pairUp and buildMarkdown", () => {
  const dirs: string[] = [];
  let before = "";
  let after = "";
  let pairs: Pair[] = [];
  const byFile = (file: string) => pairs.find((p) => p.file === file);

  beforeAll(() => {
    before = mkdtempSync(join(tmpdir(), "vis-before-"));
    after = mkdtempSync(join(tmpdir(), "vis-after-"));
    dirs.push(before, after);
    writeFileSync(join(before, "home-1440.png"), solid(4, 4, [0, 0, 0]));
    writeFileSync(join(after, "home-1440.png"), solid(4, 4, [0, 0, 0]));
    writeFileSync(join(before, "home-1440.gif"), "gif");
    writeFileSync(join(after, "home-1440.gif"), "gif");
    writeFileSync(join(before, "settings-390.png"), solid(4, 4, [0, 0, 0]));
    writeFileSync(join(after, "settings-390.png"), solid(4, 4, [255, 255, 255]));
    writeFileSync(join(before, "settings-390.gif"), "gif");
    writeFileSync(join(after, "settings-390.gif"), "gif");
    writeFileSync(join(after, "history-1440.png"), solid(4, 4, [0, 0, 0]));
    writeFileSync(join(after, "notes.txt"), "ignored");
    pairs = pairUp(before, after);
  });

  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  test("pairs every media file once, widest first", () => {
    expect(pairs.map((p) => p.file)).toEqual([
      "history-1440.png",
      "home-1440.gif",
      "home-1440.png",
      "settings-390.gif",
      "settings-390.png",
    ]);
  });

  test("a gif takes its png's diff", () => {
    expect(byFile("home-1440.gif")?.diff).toBe(0);
    expect(byFile("settings-390.gif")?.diff).toBe(1);
  });

  test("a gif whose png is unchanged is not flagged", () => {
    expect(isChanged(byFile("home-1440.gif") ?? pairs[0])).toBe(false);
  });

  test("flags new and changed files, not identical ones", () => {
    expect(pairs.map(isChanged)).toEqual([true, false, false, true, true]);
  });

  test("renders a sticky table with raw links, warnings and folded unchanged rows", () => {
    const md = buildMarkdown({
      pairs,
      beforeUrl: "https://raw/b",
      afterUrl: "https://raw/a",
      notes: ["after · job-progress@390: final stage not reached"],
    });
    expect(md.startsWith(MARKER)).toBe(true);
    expect(md).toContain('<img src="https://raw/a/settings-390.png" width="200">');
    expect(md).toContain("| **history** · 1440px | _none_ |");
    expect(md).toContain("<details><summary>2 unchanged</summary>");
    expect(md).toContain("> [!WARNING]\n> - after · job-progress@390: final stage not reached");
    expect(md).toContain("100.0%");
  });

  test("a missing manifest becomes a note", () => {
    expect(readNotes(before, "before")).toEqual([
      "before: no manifest.json (capture did not finish)",
    ]);
  });
});

describe("manifestNotes", () => {
  test("collects run warnings, scene warnings and scene errors", () => {
    const notes = manifestNotes(
      {
        warnings: ["warm-up /: timeout"],
        results: [
          { scene: "job-progress", width: 390, warnings: ["final stage not reached"] },
          { scene: "home", width: 1440, warnings: [], error: "ready never appeared" },
        ],
      },
      "after",
    );
    expect(notes).toEqual([
      "after: warm-up /: timeout",
      "after · job-progress@390: final stage not reached",
      "after · home@1440: **failed**: ready never appeared",
    ]);
  });
  test("rejects a non-object manifest", () => {
    expect(manifestNotes(null, "before")).toEqual(["before: manifest.json is not an object"]);
  });
});

describe("sampleFrames", () => {
  test("drops frames faster than the target fps and keeps delays positive", () => {
    const frames = [0, 50, 100, 260, 400, 520].map((at) => ({ png: Buffer.alloc(0), at }));
    const picked = sampleFrames(frames, 4);
    expect(picked.map((p) => p.frame.at)).toEqual([0, 260, 520]);
    expect(picked.every((p) => p.delay >= 20)).toBe(true);
  });
});
