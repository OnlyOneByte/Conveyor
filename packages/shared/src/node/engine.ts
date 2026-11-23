import { spawn } from "node:child_process";
import { StageError } from "../context.js";
import type { Stage, StageCtx } from "../index.js";

const STDERR_TAIL_CHARS = 500;

export function runEngine(stage: Stage, cmd: string, args: string[], ctx: StageCtx): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { signal: ctx.signal });
    let stderr = "";
    child.stderr.on("data", (b) => (stderr += b.toString()));
    child.on("error", (e) => reject(new StageError(stage, e.message, { cause: e })));
    child.on("close", (code) =>
      code === 0
        ? resolve()
        : reject(
            new StageError(stage, `${cmd} exited ${code}: ${stderr.slice(-STDERR_TAIL_CHARS)}`),
          ),
    );
  });
}
