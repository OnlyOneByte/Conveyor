import { describe, expect, test } from "bun:test";
import {
  bunVersionErrors,
  DOCKERFILES,
  type Files,
  imagesIn,
  PINNED,
  WORKFLOWS,
} from "./bun-version.ts";

const DIGEST = `oven/bun:debian@sha256:${"a".repeat(64)}`;
const OTHER = `oven/bun:debian@sha256:${"b".repeat(64)}`;
const ENV_REF = `\${{ env.BUN_VERSION }}`;
const PERF = `${WORKFLOWS}/make-perf.yml`;
const VISUAL = `${WORKFLOWS}/visual.yml`;
const setup = (pin: string) =>
  `      - uses: oven-sh/setup-bun@abc\n        with:\n          bun-version: ${pin}\n`;

function repo(over: Files = {}, version = "1.4.5"): Files {
  return {
    [PINNED.ci]: `env:\n  BUN_VERSION: "${version}"\njobs:\n  x:\n    steps:\n${setup(ENV_REF)}`,
    [PERF]: setup(`"${version}"`),
    [VISUAL]: setup(`"${version}"`),
    [`${WORKFLOWS}/pr-meta.yml`]: "jobs: {}\n",
    [PINNED.mise]: `[tools]\nbun = "${version}"\n`,
    [PINNED.types[0] ?? ""]:
      `{ "engines": { "bun": ">=${version}" }, "devDependencies": { "@types/bun": "~${version}" } }`,
    [PINNED.types[1] ?? ""]: `{ "devDependencies": { "@types/bun": "~${version}" } }`,
    [DOCKERFILES[0] ?? ""]: `FROM ${DIGEST} AS deps\nRUN x\nFROM ${DIGEST}\n`,
    [DOCKERFILES[1] ?? ""]: `FROM ${DIGEST} AS build\nFROM node:26\n`,
    [DOCKERFILES[2] ?? ""]: `FROM ${DIGEST} AS deps\nFROM ${DIGEST}\n`,
    ...over,
  };
}

const runs = (versions: Record<string, string>) => {
  const asked: string[] = [];
  const imageVersion = (image: string) => {
    asked.push(image);
    return `${versions[image] ?? "0.0.0"}\n`;
  };
  return { asked, imageVersion };
};

describe("bunVersionErrors", () => {
  test("passes when CI, the workflows, mise, @types/bun and every image agree", () => {
    const { asked, imageVersion } = runs({ [DIGEST]: "1.4.5" });
    expect(bunVersionErrors(repo(), imageVersion)).toEqual([]);
    expect(asked).toEqual([DIGEST]);
  });

  test("fails when the images run another Bun than CI, as on main before #731", () => {
    const { imageVersion } = runs({ [DIGEST]: "1.4.5" });
    expect(bunVersionErrors(repo({}, "1.3.14"), imageVersion)).toEqual([
      `${DIGEST} (${DOCKERFILES.join(", ")}) has Bun 1.4.5, but CI runs 1.3.14`,
    ]);
  });

  test("names each pin that differs from CI", () => {
    const { imageVersion } = runs({ [DIGEST]: "1.4.5" });
    const files = repo({
      [VISUAL]: setup(`"1.3.14"`),
      [PINNED.mise]: `bun = "1.4.4"\n`,
      [PINNED.types[1] ?? ""]: `{ "@types/bun": "~1.3.14" }`,
    });
    expect(bunVersionErrors(files, imageVersion)).toEqual([
      `${VISUAL} has Bun 1.3.14, but CI runs 1.4.5`,
      `${PINNED.mise} has Bun 1.4.4, but CI runs 1.4.5`,
      `${PINNED.types[1]} (@types/bun) has Bun 1.3.14, but CI runs 1.4.5`,
    ]);
  });

  test("checks every distinct image once, and names the Dockerfiles that use it", () => {
    const { asked, imageVersion } = runs({ [DIGEST]: "1.4.5", [OTHER]: "1.3.14" });
    const files = repo({ [DOCKERFILES[1] ?? ""]: `FROM ${OTHER} AS build\n` });
    expect(bunVersionErrors(files, imageVersion)).toEqual([
      `${OTHER} (${DOCKERFILES[1]}) has Bun 1.3.14, but CI runs 1.4.5`,
    ]);
    expect(asked.sort()).toEqual([DIGEST, OTHER].sort());
    expect(imagesIn(files).get(DIGEST)).toEqual([DOCKERFILES[0], DOCKERFILES[2]]);
  });

  test("refuses an image that isn't pinned by digest, without running it", () => {
    const { asked, imageVersion } = runs({});
    const files = repo({ [DOCKERFILES[0] ?? ""]: "FROM oven/bun:1.4.5-debian\n" });
    expect(bunVersionErrors(files, imageVersion)).toContain(
      `oven/bun:1.4.5-debian (${DOCKERFILES[0]}) isn't pinned by digest`,
    );
    expect(asked).not.toContain("oven/bun:1.4.5-debian");
  });

  test("fails when CI pins no Bun, or no Dockerfile uses a Bun image", () => {
    const { imageVersion } = runs({ [DIGEST]: "1.4.5" });
    expect(bunVersionErrors(repo({ [PINNED.ci]: "env: {}\n" }), imageVersion)).toEqual([
      `${PINNED.ci}: no BUN_VERSION: "x.y.z" found`,
    ]);
    const none = Object.fromEntries(DOCKERFILES.map((path) => [path, "FROM node:26\n"]));
    expect(bunVersionErrors(repo(none), imageVersion)).toEqual([
      `no oven/bun image in ${DOCKERFILES.join(", ")}`,
    ]);
  });

  test("scans every workflow file, and a setup-bun step must pin a version CI runs", () => {
    const { imageVersion } = runs({ [DIGEST]: "1.4.5" });
    const files = repo({
      [`${WORKFLOWS}/release.yaml`]: setup("latest"),
      [`${WORKFLOWS}/nightly.yml`]: `${setup('"1.4.5"')}      - uses: oven-sh/setup-bun@abc\n`,
      [`${WORKFLOWS}/docs.yml`]: setup(ENV_REF),
      [`${WORKFLOWS}/notes.md`]: setup("0.1.0"),
    });
    expect(bunVersionErrors(files, imageVersion)).toEqual([
      `${WORKFLOWS}/docs.yml has Bun (none), but CI runs 1.4.5`,
      `${WORKFLOWS}/nightly.yml (a setup-bun step without bun-version) has Bun (none), but CI runs 1.4.5`,
      `${WORKFLOWS}/release.yaml has Bun latest, but CI runs 1.4.5`,
    ]);
  });

  test("engines.bun must ask for the Bun CI runs", () => {
    const { imageVersion } = runs({ [DIGEST]: "1.4.5" });
    const files = repo({
      [PINNED.engines]: `{ "engines": { "bun": ">=1.1" }, "@types/bun": "~1.4.5" }`,
    });
    expect(bunVersionErrors(files, imageVersion)).toEqual([
      `${PINNED.engines} (engines.bun) has Bun 1.1, but CI runs 1.4.5`,
    ]);
  });

  test("a missing pin counts as a mismatch", () => {
    const { imageVersion } = runs({ [DIGEST]: "1.4.5" });
    expect(bunVersionErrors(repo({ [PINNED.mise]: "[tools]\n" }), imageVersion)).toEqual([
      `${PINNED.mise} has Bun (none), but CI runs 1.4.5`,
    ]);
  });
});
