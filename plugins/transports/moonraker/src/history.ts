import type { PrintStatus } from "@conveyor/shared";
import { z } from "zod";
import { poll } from "./poll.ts";

export const HISTORY_LIMIT = 20;

const HistoryReply = z.object({
  result: z.object({
    jobs: z.array(
      z.object({
        filename: z.string(),
        status: z.string(),
      }),
    ),
  }),
});

export type HistoryEnd =
  | { kind: "ended"; status: PrintStatus }
  | { kind: "running" }
  | { kind: "unknown"; why: string };

const FAILED = new Set([
  "error",
  "klippy_shutdown",
  "klippy_disconnect",
  "server_exit",
  "interrupted",
]);

function endOf(status: string): HistoryEnd {
  if (status === "completed") return { kind: "ended", status: { state: "done", progress: 1 } };
  if (status === "cancelled")
    return { kind: "ended", status: { state: "canceled", message: "print cancelled on printer" } };
  if (FAILED.has(status))
    return {
      kind: "ended",
      status: { state: "failed", message: `the job history says ${status}` },
    };
  if (status === "in_progress") return { kind: "running" };
  return { kind: "unknown", why: `unrecognised job status ${status}` };
}

export async function historyEnd(
  base: string,
  headers: Record<string, string>,
  filename: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<HistoryEnd> {
  const query = `${base}/server/history/list?limit=${HISTORY_LIMIT}&order=desc`;
  const res = await poll(query, headers, timeoutMs, signal);
  if (typeof res === "string")
    return { kind: "unknown", why: `the history request failed: ${res}` };
  const parsed = HistoryReply.safeParse(await res.json().catch(() => null));
  if (!parsed.success) return { kind: "unknown", why: "the history reply couldn't be read" };
  const job = parsed.data.result.jobs.find((entry) => entry.filename === filename);
  if (!job) return { kind: "unknown", why: `no history entry for ${filename}` };
  return endOf(job.status);
}
