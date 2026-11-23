import { parseArgs } from "node:util";

export interface RunContext {
  event: string;
  ref: string;
}

export type Git = (args: string[]) => string | null;

const git: Git = (args) => {
  const result = Bun.spawnSync(["git", ...args]);
  return result.exitCode === 0 ? result.stdout.toString().trim() : null;
};

export function pullRequestBase(context: RunContext, run: Git = git): string | null {
  if (context.event === "pull_request") return run(["rev-parse", "HEAD^1"]);
  if (context.event === "workflow_dispatch" && context.ref !== "refs/heads/main") {
    return run(["merge-base", "origin/main", "HEAD"]);
  }
  return "";
}

function main(argv: string[]): number {
  const { values } = parseArgs({ args: argv, options: { previous: { type: "string" } } });
  const base = pullRequestBase({
    event: process.env.GITHUB_EVENT_NAME ?? "",
    ref: process.env.GITHUB_REF ?? "",
  });
  if (base === null) {
    console.error("could not resolve the base commit");
    return 1;
  }
  console.log(base || (values.previous ?? ""));
  return 0;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
