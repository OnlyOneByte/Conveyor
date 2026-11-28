import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const DOCKERFILES = [
  "packages/api/Dockerfile",
  "packages/web/Dockerfile",
  "packages/worker/Dockerfile",
];

export const WORKFLOWS = ".github/workflows";

export const PINNED = {
  ci: `${WORKFLOWS}/ci.yml`,
  mise: "mise.toml",
  engines: "package.json",
  types: ["package.json", "tools/visual/package.json"],
};

const BUN_IMAGE = /^FROM\s+(oven\/bun[^\s]*)/gm;
const VERSION = /^\d+\.\d+\.\d+$/;

export type Files = Record<string, string>;
export type ImageVersion = (image: string) => string;

const first = (text: string, pattern: RegExp) => text.match(pattern)?.[1];

export function imagesIn(files: Files): Map<string, string[]> {
  const images = new Map<string, string[]>();
  for (const path of DOCKERFILES) {
    for (const match of (files[path] ?? "").matchAll(BUN_IMAGE)) {
      const image = match[1] ?? "";
      images.set(image, [...new Set([...(images.get(image) ?? []), path])]);
    }
  }
  return images;
}

type Pin = [where: string, found: string | undefined];

const ENV_PIN = /^\$\{\{\s*env\.BUN_VERSION\s*\}\}$/;

export const isWorkflow = (path: string) =>
  path.startsWith(`${WORKFLOWS}/`) && /\.ya?ml$/.test(path);

function workflowPins(path: string, text: string): Pin[] {
  const own = first(text, /^\s*BUN_VERSION:\s*"([^"]+)"/m);
  const values = [...text.matchAll(/^\s*bun-version:\s*(.*?)\s*$/gm)].map((m) =>
    (m[1] ?? "").replace(/^"(.*)"$/, "$1"),
  );
  const setups = text.match(/uses:\s*oven-sh\/setup-bun@/g)?.length ?? 0;
  const unpinned = Array.from(
    { length: Math.max(0, setups - values.length) },
    (): Pin => [`${path} (a setup-bun step without bun-version)`, undefined],
  );
  return [...values.map((v): Pin => [path, ENV_PIN.test(v) ? own : v]), ...unpinned];
}

function toolPins(files: Files): Pin[] {
  const workflows = Object.keys(files)
    .filter(isWorkflow)
    .sort()
    .flatMap((path) => workflowPins(path, files[path] ?? ""));
  const types = PINNED.types.map(
    (path): Pin => [
      `${path} (@types/bun)`,
      first(files[path] ?? "", /"@types\/bun":\s*"~([^"]+)"/),
    ],
  );
  const engines = first(files[PINNED.engines] ?? "", /"engines":\s*\{[^}]*"bun":\s*">=([^"]+)"/);
  return [
    ...workflows,
    [PINNED.mise, first(files[PINNED.mise] ?? "", /^bun\s*=\s*"([^"]+)"/m)],
    [`${PINNED.engines} (engines.bun)`, engines],
    ...types,
  ];
}

function imagePins(files: Files, imageVersion: ImageVersion, errors: string[]): Pin[] {
  const images = imagesIn(files);
  if (images.size === 0) errors.push(`no oven/bun image in ${DOCKERFILES.join(", ")}`);
  return [...images].flatMap(([image, paths]): Pin[] => {
    const where = `${image} (${paths.join(", ")})`;
    if (/@sha256:[0-9a-f]{64}$/.test(image)) return [[where, imageVersion(image).trim()]];
    errors.push(`${where} isn't pinned by digest`);
    return [];
  });
}

export function bunVersionErrors(files: Files, imageVersion: ImageVersion): string[] {
  const ci = first(files[PINNED.ci] ?? "", /^\s*BUN_VERSION:\s*"([^"]+)"/m);
  if (!ci || !VERSION.test(ci)) return [`${PINNED.ci}: no BUN_VERSION: "x.y.z" found`];
  const errors: string[] = [];
  const pins = [...toolPins(files), ...imagePins(files, imageVersion, errors)];
  const wrong = pins.filter(([, found]) => found !== ci);
  return [
    ...wrong.map(([where, found]) => `${where} has Bun ${found ?? "(none)"}, but CI runs ${ci}`),
    ...errors,
  ];
}

export const dockerBunVersion: ImageVersion = (image) => {
  const run = Bun.spawnSync([
    "docker",
    "run",
    "--rm",
    "--network",
    "none",
    image,
    "bun",
    "--version",
  ]);
  if (run.exitCode !== 0) throw new Error(`docker run ${image} failed: ${run.stderr.toString()}`);
  return run.stdout.toString();
};

if (import.meta.main) {
  const root = join(import.meta.dir, "..", "..");
  const workflows = readdirSync(join(root, WORKFLOWS)).map((name) => `${WORKFLOWS}/${name}`);
  const paths = [...DOCKERFILES, ...workflows.filter(isWorkflow), PINNED.mise, ...PINNED.types];
  const files = Object.fromEntries(paths.map((p) => [p, readFileSync(join(root, p), "utf8")]));
  const errors = bunVersionErrors(files, dockerBunVersion);
  for (const error of errors) console.error(error);
  if (errors.length === 0) console.log("CI, dev tooling and every image run the same Bun");
  process.exit(errors.length === 0 ? 0 : 1);
}
