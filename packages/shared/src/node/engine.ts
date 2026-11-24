import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { StageError } from "../context.js";
import type { Stage, StageCtx } from "../index.js";

const STDERR_TAIL_CHARS = 500;

export interface EngineRun {
  stderr: string;
}

export function runEngine(
  stage: Stage,
  cmd: string,
  args: string[],
  ctx: StageCtx,
): Promise<EngineRun> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { signal: ctx.signal });
    let stderr = "";
    child.stderr.on("data", (b) => (stderr += b.toString()));
    child.on("error", (e) => reject(new StageError(stage, e.message, { cause: e })));
    child.on("close", (code) =>
      code === 0
        ? resolve({ stderr: stderr.slice(-STDERR_TAIL_CHARS) })
        : reject(
            new StageError(stage, `${cmd} exited ${code}: ${stderr.slice(-STDERR_TAIL_CHARS)}`),
          ),
    );
  });
}

export async function requireOutput(
  stage: Stage,
  path: string,
  missing: string,
  stderr = "",
): Promise<void> {
  const size = await stat(path).then(
    (s) => (s.isFile() ? s.size : -1),
    () => -1,
  );
  if (size > 0) return;
  const said = stderr.trim();
  const empty = size === 0 ? " (the file is empty)" : "";
  throw new StageError(stage, `${missing}${empty}${said ? `: ${said}` : ""}`);
}
