import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gridfinity } from "../plugins/generators/gridfinity/src/index.ts";
import { gridfinityParams } from "../plugins/generators/gridfinity/src/params.ts";
import { orca } from "../plugins/slicers/orca/src/index.ts";

const PROFILE = {
  id: "orca/klipper-pla-0.2",
  name: "smoke",
  path: join(process.cwd(), "profiles/orca-klipper-pla-0.2"),
};

const workDir = mkdtempSync(join(tmpdir(), "gridfinity-smoke-"));
const ctx = {
  jobId: "gridfinity-smoke",
  workDir,
  signal: new AbortController().signal,
  report: () => {},
  log: (message: string) => console.log(message),
};

const model = await gridfinity.generate(
  gridfinityParams.parse({ gridX: 2, gridY: 3, heightUnits: 6 }),
  ctx,
);
const bytes = statSync(model.path).size;
console.log(`gridfinity 2x3x6 rendered ${bytes} bytes of STL`);
if (bytes < 100_000) throw new Error("gridfinity produced a suspiciously small STL");

const gcode = await orca.slice(model, PROFILE, ctx);
const moves = readFileSync(gcode.path, "utf8")
  .split("\n")
  .filter((line) => line.startsWith("G1 ")).length;
console.log(`orca sliced the bin into ${moves} G1 moves, as uid ${process.getuid?.()}`);
if (moves === 0) throw new Error("orca produced g-code with no G1 moves");
