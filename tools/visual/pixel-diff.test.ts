import { describe, expect, test } from "bun:test";
import { PNG } from "pngjs";
import { buildMarkdown, isChanged, isSubtle, type Pair, pixelDiff } from "./compare.ts";
import { solid } from "./fixtures.ts";

function shifted(size: number, patch: number, by: number): Buffer {
  const png = PNG.sync.read(solid(size, size, [40, 60, 80]));
  for (let n = 0; n < patch; n++) {
    const i = n * 4;
    png.data[i] += by;
    png.data[i + 1] += by;
    png.data[i + 2] += by;
  }
  return PNG.sync.write(png);
}

const BASE = solid(100, 100, [40, 60, 80]);

function pairOf(after: Buffer): Pair {
  return {
    file: "new-job-1440.png",
    scene: "new-job",
    width: 1440,
    kind: "png",
    before: true,
    after: true,
    diff: pixelDiff(BASE, after),
  };
}

describe("pixelDiff", () => {
  test("identical images differ by 0", () => {
    expect(pixelDiff(solid(4, 4, [10, 10, 10]), solid(4, 4, [10, 10, 10]))).toEqual({
      changed: 0,
      touched: 0,
      maxChannel: 0,
    });
  });
  test("a change of 16/255 or less is below the noise threshold but still counted as touched", () => {
    expect(pixelDiff(solid(4, 4, [10, 10, 10]), solid(4, 4, [20, 20, 20]))).toEqual({
      changed: 0,
      touched: 1,
      maxChannel: 10,
    });
  });
  test("different colours differ fully", () => {
    expect(pixelDiff(solid(4, 4, [0, 0, 0]), solid(4, 4, [255, 0, 0]))).toEqual({
      changed: 1,
      touched: 1,
      maxChannel: 255,
    });
  });
  test("different sizes count as fully changed", () => {
    expect(pixelDiff(solid(4, 4, [0, 0, 0]), solid(4, 5, [0, 0, 0]))).toEqual({
      changed: 1,
      touched: 1,
      maxChannel: 255,
    });
  });
});

describe("a uniform shift below the noise threshold", () => {
  test("a 4% patch shifted by 9/255 reports 0% over threshold, 4% touched and a largest change of 9", () => {
    expect(pixelDiff(BASE, shifted(100, 400, 9))).toEqual({
      changed: 0,
      touched: 0.04,
      maxChannel: 9,
    });
  });

  test("is not folded as unchanged once more than 0.5% of pixels moved", () => {
    const patch = pairOf(shifted(100, 400, 9));
    expect(isChanged(patch)).toBe(true);
    expect(isSubtle(patch)).toBe(true);
  });

  test("a whole-image shift of exactly 16/255 counts as a subtle change", () => {
    const whole = pairOf(shifted(100, 100 * 100, 16));
    expect(whole.diff).toEqual({ changed: 0, touched: 1, maxChannel: 16 });
    expect(isChanged(whole)).toBe(true);
    expect(isSubtle(whole)).toBe(true);
  });

  test("is listed however few pixels it touches, and only an identical capture folds", () => {
    expect(isChanged(pairOf(BASE))).toBe(false);
    expect(isSubtle(pairOf(BASE))).toBe(false);
    expect(isChanged(pairOf(shifted(100, 1, 1)))).toBe(true);
    expect(isChanged(pairOf(shifted(100, 50, 9)))).toBe(true);
  });

  test("is listed with all three numbers and the faint-change note, not as no visible changes", () => {
    const md = buildMarkdown({
      pairs: [pairOf(shifted(100, 400, 9))],
      beforeUrl: "https://raw/b",
      afterUrl: "https://raw/a",
    });
    expect(md).not.toContain("No visible changes");
    expect(md).toContain("| Δ pixels (> 16/255) | Any Δ | Largest Δ |");
    expect(md).toContain("| 0.00% | 4.0% | 9/255 |");
    expect(md).toContain("1 of these changed faintly");
  });

  test("a strong change on few pixels next to a faint one is listed but not called faint", () => {
    const png = PNG.sync.read(BASE);
    for (let n = 0; n < 140; n++) {
      const by = n < 40 ? 128 : 9;
      for (let c = 0; c < 3; c++) png.data[n * 4 + c] += by;
    }
    const mixed = pairOf(PNG.sync.write(png));
    expect(mixed.diff).toEqual({ changed: 0.004, touched: 0.014, maxChannel: 128 });
    expect(isChanged(mixed)).toBe(true);
    expect(isSubtle(mixed)).toBe(false);
    const md = buildMarkdown({ pairs: [mixed], beforeUrl: "b", afterUrl: "a" });
    expect(md).toContain("| 0.40% | 1.4% | 128/255 |");
    expect(md).not.toContain("changed faintly");
  });

  test("an 88x88 square at full contrast on a 1440x1087 capture is listed, not folded", () => {
    const before = solid(1440, 1087, [0, 0, 0]);
    const png = PNG.sync.read(before);
    for (let y = 0; y < 88; y++) {
      for (let x = 0; x < 88; x++) {
        const i = (y * 1440 + x) * 4;
        png.data[i] = 255;
        png.data[i + 1] = 255;
        png.data[i + 2] = 255;
      }
    }
    const diff = pixelDiff(before, PNG.sync.write(png));
    expect(diff.touched).toBeCloseTo((88 * 88) / (1440 * 1087), 10);
    expect(diff.touched).toBeLessThan(0.005);
    expect(diff.maxChannel).toBe(255);
    const square: Pair = { ...pairOf(BASE), diff };
    expect(isChanged(square)).toBe(true);
    const md = buildMarkdown({ pairs: [square], beforeUrl: "b", afterUrl: "a" });
    expect(md).not.toContain("No visible changes");
    expect(md).not.toContain("<details>");
    expect(md).toContain("| 0.49% | 0.49% | 255/255 |");
  });

  test("a one-pixel change shows as <0.01% rather than 0.00%", () => {
    const md = buildMarkdown({
      pairs: [
        { ...pairOf(BASE), diff: { changed: 1 / 1565280, touched: 1 / 1565280, maxChannel: 255 } },
      ],
      beforeUrl: "b",
      afterUrl: "a",
    });
    expect(md).toContain("| <0.01% | <0.01% | 255/255 |");
  });

  test("a clearly visible change does not get the faint-change note", () => {
    const visible = pairOf(solid(100, 100, [255, 255, 255]));
    expect(isSubtle(visible)).toBe(false);
    const md = buildMarkdown({ pairs: [visible], beforeUrl: "b", afterUrl: "a" });
    expect(md).not.toContain("changed faintly");
  });
});
