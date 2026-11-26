import { expect, test } from "bun:test";
import { chmodSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDirs } from "../../packages/shared/test/helpers/temp.ts";

const ROOT = realpathSync(join(import.meta.dir, "..", ".."));
const SCRIPT = join(import.meta.dir, "scan-image.sh");
const dirs = tempDirs("conveyor-scan-image-");

async function runWithFakeDocker(cache: string) {
  const dir = realpathSync(await dirs());
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const calls = join(dir, "calls.txt");
  writeFileSync(join(bin, "docker"), `#!/usr/bin/env bash\nprintf '%s\\n' "$*" >> "${calls}"\n`);
  chmodSync(join(bin, "docker"), 0o755);
  const run = Bun.spawnSync(["bash", SCRIPT, "conveyor-api"], {
    cwd: dir,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      TRIVY_CACHE: cache,
      HOME: dir,
      GITHUB_STEP_SUMMARY: "",
    },
  });
  return { dir, code: run.exitCode, calls: readFileSync(calls, "utf8").trim().split("\n") };
}

test("a relative TRIVY_CACHE is mounted as an absolute path, beside the repo's allowlist", async () => {
  const { dir, code, calls } = await runWithFakeDocker("cache/trivy");
  expect(code).toBe(0);
  expect(calls).toHaveLength(3);
  for (const call of calls) {
    expect(call).toContain(`-v ${dir}/cache/trivy:/root/.cache/trivy`);
    expect(call).toContain(`-v ${ROOT}/.github/image-scan-allowlist.yaml:/allowlist.yaml:ro`);
  }
  expect(calls[2]).toContain("--ignorefile /allowlist.yaml");
  expect(calls[2]).toContain("--severity CRITICAL,HIGH");
  expect(calls[2]).toContain("--exit-code 1");
});

test("an absolute TRIVY_CACHE is used as given", async () => {
  const absolute = join(await dirs(), "abs-cache");
  const { calls } = await runWithFakeDocker(absolute);
  expect(calls[0]).toContain(`-v ${absolute}:/root/.cache/trivy`);
});
