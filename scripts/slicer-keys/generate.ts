import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { DENIED_KEY } from "../../packages/shared/src/slicer-key-policy";

const ROOT = join(import.meta.dir, "..", "..");
const PROFILES = join(ROOT, "profiles");
const OUT = join(ROOT, "packages", "shared", "slicer-keys");
const AXES = ["x", "y", "z", "e"];

const SOURCES = {
  prusa: {
    url: "https://raw.githubusercontent.com/prusa3d/PrusaSlicer/68c34beb95e2b319be7fe325a89abdbc28f2d72d/src/slic3r-shared/src/Slic3r/Biz/Config/Legacy/PrintConfig.cpp",
    limits: ["feedrate", "acceleration", "jerk"],
    extra: [],
    prefix: "prusa-",
  },
  orca: {
    url: "https://raw.githubusercontent.com/OrcaSlicer/OrcaSlicer/1de01873ae15566ce4d407a98209bf442380a2cf/src/libslic3r/PrintConfig.cpp",
    limits: ["speed", "acceleration", "jerk"],
    extra: [
      "type",
      "name",
      "inherits",
      "from",
      "setting_id",
      "instantiation",
      "version",
      "filament_id",
      "is_custom_defined",
      "description",
    ],
    prefix: "orca-",
  },
};

const upstreamKeys = async (url: string) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  const source = await response.text();
  const end = source.indexOf("void PrintConfigDef::handle_legacy(");
  if (end < 0) throw new Error(`${url}: handle_legacy not found`);
  return [...source.slice(0, end).matchAll(/add(?:_nullable)?\("([a-z0-9_]+)"/g)].map((m) => m[1]);
};

const iniKeys = (text: string) =>
  text.split(/\r?\n/).flatMap((line) => /^\s*([^#;[\s=][^=]*?)\s*=/.exec(line)?.[1] ?? []);

const fileKeys = (path: string) => {
  const text = readFileSync(path, "utf8");
  if (path.endsWith(".json")) return Object.keys(JSON.parse(text));
  if (path.endsWith(".ini")) return iniKeys(text);
  return [];
};

const bundledKeys = (prefix: string) =>
  readdirSync(PROFILES)
    .filter((dir) => dir.startsWith(prefix))
    .flatMap((dir) => readdirSync(join(PROFILES, dir)).map((file) => join(PROFILES, dir, file)))
    .flatMap(fileKeys);

const build = async ({ url, limits, extra, prefix }: (typeof SOURCES)[keyof typeof SOURCES]) => {
  const axisKeys = limits.flatMap((limit) => AXES.map((axis) => `machine_max_${limit}_${axis}`));
  const keys = new Set([
    ...(await upstreamKeys(url)),
    ...axisKeys,
    ...extra,
    ...bundledKeys(prefix),
  ]);
  const allowed = [...keys].filter((key) => !DENIED_KEY.test(key)).sort();
  return `${JSON.stringify(allowed, null, 2)}\n`;
};

const { values } = parseArgs({ options: { check: { type: "boolean" } } });
let stale = false;
for (const [slicer, source] of Object.entries(SOURCES)) {
  const file = join(OUT, `${slicer}.json`);
  const next = await build(source);
  if (values.check) {
    if (readFileSync(file, "utf8") !== next) {
      console.error(`${file} is stale; run bun run slicer-keys`);
      stale = true;
    }
  } else {
    writeFileSync(file, next);
    console.log(`wrote ${file}`);
  }
}
process.exit(stale ? 1 : 0);
