import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { orca } from "../plugins/slicers/orca/src/index.ts";

const PROFILE = {
  id: "orca/klipper-pla-0.2",
  name: "smoke",
  path: "profiles/orca-klipper-pla-0.2",
};

function renderCube(workDir: string): string {
  const scad = join(workDir, "cube.scad");
  const stl = join(workDir, "cube.stl");
  writeFileSync(scad, "cube([20, 20, 10]);\n");
  const openscad = process.env.OPENSCAD_BIN ?? "openscad";
  const result = spawnSync(openscad, ["-o", stl, scad], { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${openscad} exited ${result.status}`);
  return stl;
}

const workDir = mkdtempSync(join(tmpdir(), "orca-smoke-"));
const gcode = await orca.slice(
  { path: renderCube(workDir), format: "stl" },
  { ...PROFILE, path: join(process.cwd(), PROFILE.path) },
  {
    jobId: "orca-smoke",
    workDir,
    signal: new AbortController().signal,
    report: () => {},
    log: (message: string) => console.log(message),
  },
);
const lines = readFileSync(gcode.path, "utf8").split("\n");
const moves = lines.filter((line) => line.startsWith("G1 ")).length;
console.log(`orca sliced ${lines.length} lines, ${moves} G1 moves, as uid ${process.getuid?.()}`);
if (moves === 0) throw new Error("orca produced g-code with no G1 moves");
