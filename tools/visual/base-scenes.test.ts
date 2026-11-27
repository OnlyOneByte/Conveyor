import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { missingFrom, sceneNamesAt, skipsOnBase } from "./base-scenes.ts";

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

test("the scenes the base lacks are the ones to skip, in the order asked", () => {
  const base = new Set(["jobs", "printers"]);
  expect(missingFrom(base, ["printers-down", "jobs", "receipt-held"])).toEqual([
    "printers-down",
    "receipt-held",
  ]);
  expect(missingFrom(base, ["jobs", "printers"])).toEqual([]);
});

test("with no base scene list, nothing is skipped", () => {
  expect(missingFrom(null, ["jobs", "printers-down"])).toEqual([]);
});

test("the base's scene names come from its own scenes.ts", async () => {
  const root = await baseWith(
    'export const scenes = [{ name: "jobs" }, { name: "printers" }, { route: "/" }];\n',
  );
  expect(await sceneNamesAt(root)).toEqual(new Set(["jobs", "printers"]));
});

test("a base without a scene list, or one that won't load, gives no list", async () => {
  expect(await sceneNamesAt(await baseWith(null))).toBeNull();
  expect(await sceneNamesAt(await baseWith('throw new Error("broken base");\n'))).toBeNull();
  expect(await sceneNamesAt(await baseWith("export const scenes = 3;\n"))).toBeNull();
});

test("each scene the base lacks gets a new-on-this-PR reason, and the head side skips none", async () => {
  const root = await baseWith('export const scenes = [{ name: "jobs" }];\n');
  const wanted = [{ name: "jobs" }, { name: "printers-down" }];
  expect([...(await skipsOnBase(root, wanted)).entries()]).toEqual([
    ["printers-down", "not on the base: it has no scene printers-down, so it is new on this PR"],
  ]);
  expect((await skipsOnBase(null, wanted)).size).toBe(0);
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
