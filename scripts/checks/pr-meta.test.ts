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
  `#!/usr/bin/env bash\necho "$2" >> "$GH_CALLS"\ncase "$2" in\n  */pulls/7) printf '%s' "$FAKE_PR" ;;\n  */issues/425) echo issue ;;\n  */issues/381) echo "a pull request" ;;\n  */issues/503) echo "gh: Service Unavailable (HTTP 503)" >&2; exit 1 ;;\n  *) echo "gh: Not Found (HTTP 404)" >&2; exit 1 ;;\nesac\n`,
);
chmodSync(join(bin, "gh"), 0o755);

afterAll(() => rmSync(bin, { recursive: true, force: true }));

interface Pr {
  number?: number;
  author?: string;
  title?: string;
  body?: string | null;
  labels?: string[];
}

let runs = 0;

function check(pr: Pr) {
  const calls = join(bin, `calls-${++runs}`);
  writeFileSync(calls, "");
  const live = {
    user: { login: pr.author ?? "OnlyOneByte" },
    title: pr.title ?? "ci(guard): check PR metadata in CI",
    body: pr.body === undefined ? "## What\r\n\r\nCloses #425\r\n" : pr.body,
    labels: (pr.labels ?? ["agent", "area/infra"]).map((name) => ({ name })),
  };
  const result = Bun.spawnSync(["bash", "-c", script], {
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      REPO: "OnlyOneByte/Conveyor",
      AGENT_LOGIN: "OnlyOneByte",
      PR_NUMBER: String(pr.number ?? 7),
      FAKE_PR: JSON.stringify(live),
      GH_CALLS: calls,
    },
  });
  const ghCalls = readFileSync(calls, "utf8").split("\n").filter(Boolean);
  return { code: result.exitCode, out: result.stdout.toString(), ghCalls };
}

describe("the pr-meta job", () => {
  test("re-runs when the title, body or labels change, and only reads issues and PRs", () => {
    expect(field(field(field(workflow, "on"), "pull_request"), "types")).toEqual(
      expect.arrayContaining(["opened", "edited", "synchronize", "labeled", "unlabeled"]),
    );
    expect(field(workflow, "permissions")).toEqual({ issues: "read", "pull-requests": "read" });
    expect(steps.map((step) => String(field(step, "uses") ?? ""))).not.toContainEqual(
      expect.stringContaining("checkout"),
    );
  });

  test("never cancels its own runs, because a cancelled required check blocks the merge", () => {
    expect(field(workflow, "concurrency")).toBeUndefined();
    expect(field(field(field(workflow, "jobs"), "pr-meta"), "concurrency")).toBeUndefined();
  });

  test("reads the PR as it is now, not the event that started the run", () => {
    const env = field(steps[0], "env");
    expect(Object.keys(isRecord(env) ? env : {}).sort()).toEqual([
      "AGENT_LOGIN",
      "GH_TOKEN",
      "PR_NUMBER",
      "REPO",
    ]);
    expect(script).toContain('gh api "repos/$REPO/pulls/$PR_NUMBER"');
  });

  test("puts no workflow expression and no event file in the script", () => {
    expect(script).not.toContain("${{");
    expect(script).not.toContain("GITHUB_EVENT_PATH");
  });

  test("fails, asking for a re-run, and stops at once when the PR can't be read", () => {
    const { code, out, ghCalls } = check({ number: 8 });
    expect(code).toBe(1);
    expect(out.trim()).toBe("::error::Could not read PR #8, so re-run this check.");
    expect(ghCalls).toEqual(["repos/OnlyOneByte/Conveyor/pulls/8"]);
  });

  test.each([
    ["a newline", "ci(guard): fine\n::warning::injected"],
    ["a carriage return", "ci(guard): fine\r::warning::injected"],
  ])("fails a title with %s, without echoing a workflow command", (_name, title) => {
    const { code, out } = check({ title });
    expect(code).toBe(1);
    expect(out).toContain("Title contains a line break");
    expect(out.split(/\r?\n|\r/).filter((line) => line.startsWith("::warning::"))).toEqual([]);
  });

  test.each([
    ["a newline", "bad title\n::warning::injected"],
    ["a carriage return", "bad title\r::warning::injected"],
    ["a CRLF", "bad title\r\n::warning::injected"],
  ])("keeps a bad title's error on one line when it holds %s", (_name, title) => {
    const { code, out } = check({ title });
    expect(code).toBe(1);
    const lines = out.split(/\r?\n|\r/).filter(Boolean);
    expect(lines.every((line) => line.startsWith("::error::"))).toBe(true);
    expect(out).toContain(`<summary>: ${title.replace(/[\r\n]/g, " ")}`);
  });

  test("passes a title whose only line break is a trailing newline, which bash drops before any check or echo", () => {
    const { code, out } = check({ title: "ci(guard): check PR metadata in CI\n" });
    expect(code).toBe(0);
    expect(out).not.toContain("::error::");
  });

  test("treats a PR with no body as having no issue line", () => {
    const { code, out } = check({ body: null });
    expect(code).toBe(1);
    expect(out).toContain("needs a line");
  });

  test("passes a well-formed agent PR", () => {
    expect(check({})).toMatchObject({ code: 0, out: expect.stringContaining("are fine") });
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
    ["a number that doesn't exist", { body: "Part of #999" }, "(not found)"],
    ["a failed lookup, saying so", { body: "Closes #503" }, "Could not look up #503"],
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
