import { writeFileSync } from "node:fs";
import { join } from "node:path";

export const sh = (cwd: string, args: string[], env: Record<string, string> = {}) => {
  const result = Bun.spawnSync(args, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@example.com",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@example.com",
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    code: result.exitCode,
    out: result.stdout.toString().trim(),
    err: result.stderr.toString(),
  };
};

export const commit = (root: string, files: Record<string, string>, message: string) => {
  for (const [path, text] of Object.entries(files)) writeFileSync(join(root, path), text);
  sh(root, ["git", "add", "-A"]);
  sh(root, ["git", "commit", "-q", "-m", message]);
  return sh(root, ["git", "rev-parse", "HEAD"]).out;
};
