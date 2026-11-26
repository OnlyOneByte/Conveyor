import { filesToPrune, StageError } from "@conveyor/shared";
import { refuseRedirect } from "@conveyor/shared/node";
import { z } from "zod";
import { poll } from "./poll.ts";
import { parseQuery } from "./query.ts";

const FileList = z.object({ result: z.array(z.object({ path: z.string() })) });

async function readJson(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
  what: string,
  signal: AbortSignal,
): Promise<unknown> {
  const res = await poll(url, headers, timeoutMs, signal);
  if (typeof res === "string") throw new StageError("transport", `${what} failed: ${res}`);
  return res.json();
}

async function printingFile(
  base: string,
  headers: Record<string, string>,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<string | undefined> {
  const json = await readJson(
    `${base}/printer/objects/query?print_stats`,
    headers,
    timeoutMs,
    "moonraker status query",
    signal,
  );
  const stats = parseQuery(json).print_stats;
  if (!stats?.state) throw new StageError("transport", "moonraker gave no printer state");
  const busy = stats.state === "printing" || stats.state === "paused";
  if (busy && !stats.filename)
    throw new StageError("transport", `moonraker is ${stats.state} but names no file`);
  return stats.filename || undefined;
}

export async function pruneGcodes(
  base: string,
  headers: Record<string, string>,
  keep: ReadonlySet<string>,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<string[]> {
  const printing = await printingFile(base, headers, timeoutMs, signal);
  const json = await readJson(
    `${base}/server/files/list?root=gcodes`,
    headers,
    timeoutMs,
    "moonraker file list",
    signal,
  );
  const listed = FileList.safeParse(json);
  if (!listed.success)
    throw new StageError(
      "transport",
      `moonraker file list: unexpected reply: ${listed.error.message}`,
    );
  const top = listed.data.result.map(({ path }) => path).filter((path) => !path.includes("/"));
  const doomed = filesToPrune(top, keep, printing);
  const removed: string[] = [];
  for (const name of doomed) {
    const res = await fetch(`${base}/server/files/gcodes/${encodeURIComponent(name)}`, {
      method: "DELETE",
      headers,
      redirect: "manual",
      signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
    });
    refuseRedirect(res, "moonraker file delete");
    if (!res.ok)
      throw new StageError(
        "transport",
        `moonraker could not delete ${name}: ${res.status}; removed ${removed.join(", ") || "none"}`,
      );
    removed.push(name);
  }
  return removed;
}
