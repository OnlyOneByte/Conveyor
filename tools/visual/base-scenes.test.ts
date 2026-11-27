import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { baseSceneList, planBase, skipsOnBase } from "./base-scenes.ts";

const scratch: string[] = [];

afterEach(async () => {
  for (const dir of scratch.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function baseWith(source: string | null): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "visual-base-scenes-"));
  scratch.push(root);
  if (source === null) return root;
  await mkdir(join(root, "tools/visual"), { recursive: true });
  await writeFile(join(root, "tools/visual/scenes.ts"), source);
  return root;
}

const list = (...names: [string, string][]) => ({
  scenes: names.map(([name, route]) => ({ name, route })),
});

test("the scenes the base lacks are skipped as new, in the order asked", () => {
  const base = list(["jobs", "/jobs"], ["printers", "/printers"]);
  const wanted = [{ name: "printers-down" }, { name: "jobs" }, { name: "receipt-held" }];
  const plan = planBase(base, wanted, [...base.scenes, { name: "printers-down", route: "/x" }]);
  expect([...plan.skips.keys()]).toEqual(["printers-down", "receipt-held"]);
  expect(plan.skips.get("receipt-held")).toBe(
    "not on the base: it has no scene receipt-held, so it is new on this PR",
  );
  expect(plan.notes).toEqual([]);
});

test("a scene the base had under another name on the same route is listed as not compared", () => {
  const base = list(["jobs", "/jobs"], ["printers-old", "/printers"]);
  const head = [
    { name: "jobs", route: "/jobs" },
    { name: "printers-new", route: "/printers" },
    { name: "fresh", route: "/fresh" },
  ];
  const plan = planBase(base, head, head);
  expect([...plan.skips.keys()]).toEqual(["printers-new", "fresh"]);
  expect(plan.notes).toEqual([
    "not compared: printers-new may be the base's printers-old, renamed",
  ]);
});

test("an unusable base list skips nothing and leaves one warning with the reason", () => {
  const wanted = [{ name: "jobs" }, { name: "printers-down" }];
  const plan = planBase({ reason: "its scene list is empty" }, wanted, []);
  expect(plan.skips.size).toBe(0);
  expect(plan.notes).toEqual([
    "the base's scene list can't be used (its scene list is empty), so every scene runs on it",
  ]);
});

test("the base's scenes come from its own scenes.ts, with their routes", async () => {
  const root = await baseWith(
    'export const scenes = [{ name: "jobs", route: "/jobs" }, { name: "p" }, { route: "/" }];\n',
  );
  expect(await baseSceneList(root)).toEqual(list(["jobs", "/jobs"], ["p", ""]));
});

test("a missing, broken, non-array or empty base list gives its reason", async () => {
  const reason = async (source: string | null) => {
    const got = await baseSceneList(await baseWith(source));
    return "reason" in got ? got.reason : "a list";
  };
  expect(await reason(null)).toBe("it has no tools/visual/scenes.ts");
  expect(await reason('throw new Error("broken base");\n')).toBe(
    "its scene list failed to load: broken base",
  );
  expect(await reason("export const scenes = 3;\n")).toBe("its scenes.ts exports no scenes array");
  expect(await reason("export const scenes = [];\n")).toBe("its scene list is empty");
  expect(await reason('export const scenes = [{ route: "/" }];\n')).toBe("its scene list is empty");
});

test("an empty base list on disk falls back to capturing every scene, with one note", async () => {
  const root = await baseWith("export const scenes = [];\n");
  const plan = await skipsOnBase(root, [{ name: "jobs" }], [{ name: "jobs", route: "/jobs" }]);
  expect(plan.skips.size).toBe(0);
  expect(plan.notes).toHaveLength(1);
  expect(plan.notes[0]).toContain("its scene list is empty");
});

test("the head side plans nothing", async () => {
  const plan = await skipsOnBase(false, [{ name: "jobs" }], []);
  expect(plan).toEqual({ skips: new Map(), notes: [] });
});

test("the base capture skips a scene its list lacks without loading a page", async () => {
  const out = await mkdtemp(join(tmpdir(), "visual-base-out-"));
  scratch.push(out);
  const root = await baseWith('export const scenes = [{ name: "jobs" }];\n');
  let hits = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => {
      hits++;
      return new Response("<!doctype html><title>Old · Conveyor</title><h1>Old</h1>");
    },
  });
  try {
    const run = Bun.spawn({
      cmd: [
        process.execPath,
        join(import.meta.dir, "capture.ts"),
        `--url=http://127.0.0.1:${server.port}`,
        `--root=${root}`,
        `--out=${out}`,
        "--only=job-detail",
        "--base",
      ],
      stdout: "ignore",
      stderr: "ignore",
    });
    expect(await run.exited).toBe(0);
    const manifest = JSON.parse(await readFile(join(out, "manifest.json"), "utf8"));
    expect(hits).toBe(0);
    const shots = manifest.results.map((r: { width: number; png?: string }) => [r.width, r.png]);
    expect(shots).toEqual([
      [1440, undefined],
      [390, undefined],
    ]);
    expect(manifest.results[1].warnings[0]).toContain("it has no scene job-detail");
  } finally {
    server.stop(true);
  }
}, 40000);

test("the base capture logs one warning when it falls back, and still runs the scene", async () => {
  const out = await mkdtemp(join(tmpdir(), "visual-base-out-"));
  scratch.push(out);
  const root = await baseWith("export const scenes = [];\n");
  let hits = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => {
      hits++;
      return new Response("<!doctype html><title>Old · Conveyor</title><h1>Old</h1>");
    },
  });
  try {
    const run = Bun.spawn({
      cmd: [
        process.execPath,
        join(import.meta.dir, "capture.ts"),
        `--url=http://127.0.0.1:${server.port}`,
        `--root=${root}`,
        `--out=${out}`,
        "--only=job-detail",
        "--base",
      ],
      stdout: "pipe",
      stderr: "ignore",
    });
    const printed = await new Response(run.stdout).text();
    expect(await run.exited).toBe(0);
    const manifest = JSON.parse(await readFile(join(out, "manifest.json"), "utf8"));
    expect(hits).toBeGreaterThan(0);
    const fellBack = (w: string) => w.includes("its scene list is empty");
    expect(manifest.warnings.filter(fellBack)).toHaveLength(1);
    expect(printed.split("\n").filter(fellBack)).toHaveLength(1);
  } finally {
    server.stop(true);
  }
}, 40000);
