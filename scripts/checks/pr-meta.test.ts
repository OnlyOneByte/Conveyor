import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const field = (value: unknown, key: string): unknown => (isRecord(value) ? value[key] : undefined);

const workflow: unknown = Bun.YAML.parse(
  readFileSync(join(ROOT, ".github/workflows/pr-meta.yml"), "utf8"),
);

const steps = (() => {
  const raw = field(field(field(workflow, "jobs"), "pr-meta"), "steps");
  return Array.isArray(raw) ? raw : [];
})();

const script = steps.map((step) => field(step, "run")).find((run) => typeof run === "string") ?? "";

const bin = mkdtempSync(join(tmpdir(), "pr-meta-"));
writeFileSync(
  join(bin, "gh"),
  `#!/usr/bin/env bash\ncase "$2" in\n  */issues/425) echo issue ;;\n  */issues/381) echo "a pull request" ;;\n  *) exit 1 ;;\nesac\n`,
);
chmodSync(join(bin, "gh"), 0o755);

afterAll(() => rmSync(bin, { recursive: true, force: true }));

interface Pr {
  author?: string;
  title?: string;
  body?: string;
  labels?: string[];
}

function check(pr: Pr) {
  const result = Bun.spawnSync(["bash", "-c", script], {
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      REPO: "OnlyOneByte/Conveyor",
      AGENT_LOGIN: "OnlyOneByte",
      PR_AUTHOR: pr.author ?? "OnlyOneByte",
      PR_TITLE: pr.title ?? "ci(guard): check PR metadata in CI",
      PR_BODY: pr.body ?? "## What\r\n\r\nCloses #425\r\n",
      PR_LABELS: JSON.stringify(pr.labels ?? ["agent", "area/infra"]),
    },
  });
  return { code: result.exitCode, out: result.stdout.toString() };
}

describe("the pr-meta job", () => {
  test("re-runs when the title, body or labels change, and reads issues only", () => {
    expect(field(field(field(workflow, "on"), "pull_request"), "types")).toEqual(
      expect.arrayContaining(["opened", "edited", "synchronize", "labeled", "unlabeled"]),
    );
    expect(field(workflow, "permissions")).toEqual({ issues: "read" });
    expect(steps.map((step) => String(field(step, "uses") ?? ""))).not.toContainEqual(
      expect.stringContaining("checkout"),
    );
  });

  test("passes a well-formed agent PR", () => {
    expect(check({})).toEqual({ code: 0, out: expect.stringContaining("are fine") });
  });

  test.each([
    ["an unknown type", { title: "feature: add a thing" }, "doesn't match"],
    ["an unknown scope", { title: "fix(ui): add a thing" }, "doesn't match"],
    ["no space after the colon", { title: "fix:add a thing" }, "doesn't match"],
    ["a title over 72 characters", { title: `docs: ${"a".repeat(67)}` }, "at most 72"],
    ["no area label", { labels: ["agent"] }, "exactly one area/*"],
    ["two area labels", { labels: ["agent", "area/ui", "area/infra"] }, "exactly one area/*"],
    ["an agent PR without the agent label", { labels: ["area/ui"] }, "need the agent label"],
    ["no issue line", { body: "Fixes the thing, see #425" }, "needs a line"],
    ["a pull request named as the issue", { body: "Closes #381" }, "not an issue"],
    ["a number that doesn't exist", { body: "Part of #999" }, "not an issue"],
  ])("fails %s", (_name, pr, message) => {
    const { code, out } = check(pr);
    expect(code).toBe(1);
    expect(out).toContain(message);
  });

  test("accepts several issues on one line, in either form", () => {
    expect(check({ body: "Closes #425, closes #425\npart of #425" }).code).toBe(0);
  });

  test("leaves the agent label to agent PRs and skips dependabot", () => {
    expect(check({ author: "someone", labels: ["area/ui"] }).code).toBe(0);
    expect(check({ author: "dependabot[bot]", title: "bump", labels: [], body: "" }).code).toBe(0);
  });
});
