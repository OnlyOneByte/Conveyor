import { describe, expect, test } from "bun:test";
import { bunVersionErrors, DOCKERFILES, type Files, imagesIn, PINNED } from "./bun-version.ts";

const DIGEST = `oven/bun:debian@sha256:${"a".repeat(64)}`;
const OTHER = `oven/bun:debian@sha256:${"b".repeat(64)}`;

function repo(over: Files = {}, version = "1.4.5"): Files {
  return {
    [PINNED.ci]: `env:\n  BUN_VERSION: "${version}"\njobs:\n  x:\n    steps:\n      - with:\n          bun-version: \${{ env.BUN_VERSION }}\n`,
    [PINNED.workflows[0] ?? ""]: `      - with:\n          bun-version: "${version}"\n`,
    [PINNED.workflows[1] ?? ""]: `      - with:\n          bun-version: "${version}"\n`,
    [PINNED.mise]: `[tools]\nbun = "${version}"\n`,
    [PINNED.types[0] ?? ""]: `{ "devDependencies": { "@types/bun": "~${version}" } }`,
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
      [PINNED.workflows[1] ?? ""]: `          bun-version: "1.3.14"\n`,
      [PINNED.mise]: `bun = "1.4.4"\n`,
      [PINNED.types[1] ?? ""]: `{ "@types/bun": "~1.3.14" }`,
    });
    expect(bunVersionErrors(files, imageVersion)).toEqual([
      `${PINNED.workflows[1]} has Bun 1.3.14, but CI runs 1.4.5`,
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

  test("a missing pin counts as a mismatch", () => {
    const { imageVersion } = runs({ [DIGEST]: "1.4.5" });
    expect(bunVersionErrors(repo({ [PINNED.mise]: "[tools]\n" }), imageVersion)).toEqual([
      `${PINNED.mise} has Bun (none), but CI runs 1.4.5`,
    ]);
  });
});
