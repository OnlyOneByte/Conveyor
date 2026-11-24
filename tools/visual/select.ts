import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { selectScenes } from "./affected.ts";
import { scenes } from "./scenes.ts";

const { values } = parseArgs({
  options: {
    root: { type: "string", default: resolve(import.meta.dir, "../..") },
    changed: { type: "string" },
  },
});

if (!values.changed)
  throw new Error("--changed <file listing one changed path per line> is required");
const changed = readFileSync(values.changed, "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter(Boolean);
const selection = selectScenes(resolve(values.root), changed, scenes);
if (selection.all) {
  console.error(`visual: full capture (${selection.reason})`);
  console.log("all");
} else {
  console.error(
    `visual: ${selection.scenes.length} of ${scenes.length} scenes reach a changed file`,
  );
  console.log(selection.scenes.join(","));
}
