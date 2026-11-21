import { describe, expect, test } from "bun:test";
import { PNG } from "pngjs";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MARKER, buildMarkdown, isChanged, pairUp, pixelDiff } from "./compare.ts";
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
  const before = mkdtempSync(join(tmpdir(), "vis-before-"));
  const after = mkdtempSync(join(tmpdir(), "vis-after-"));
  writeFileSync(join(before, "home-1440.png"), solid(4, 4, [0, 0, 0]));
  writeFileSync(join(after, "home-1440.png"), solid(4, 4, [0, 0, 0]));
  writeFileSync(join(before, "settings-390.png"), solid(4, 4, [0, 0, 0]));
  writeFileSync(join(after, "settings-390.png"), solid(4, 4, [255, 255, 255]));
  writeFileSync(join(after, "history-1440.png"), solid(4, 4, [0, 0, 0]));
  writeFileSync(join(before, "settings-390.gif"), "gif");
  writeFileSync(join(after, "settings-390.gif"), "gif");
  writeFileSync(join(after, "notes.txt"), "ignored");

  const pairs = pairUp(before, after);

  test("pairs every media file once, widest first", () => {
    expect(pairs.map((p) => p.file)).toEqual(["history-1440.png", "home-1440.png", "settings-390.gif", "settings-390.png"]);
  });

  test("flags new and changed files, not identical ones, and gifs follow their png", () => {
    expect(pairs.map(isChanged)).toEqual([true, false, true, true]);
  });

  test("renders a sticky table with raw links and folds unchanged rows", () => {
    const md = buildMarkdown({ pairs, beforeUrl: "https://raw/b", afterUrl: "https://raw/a" });
    expect(md.startsWith(MARKER)).toBe(true);
    expect(md).toContain('<img src="https://raw/a/settings-390.png" width="200">');
    expect(md).toContain("| **history** · 1440px | _none_ |");
    expect(md).toContain("<details><summary>1 unchanged</summary>");
    expect(md).toContain("100.0%");
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
