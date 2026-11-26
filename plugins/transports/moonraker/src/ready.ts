import { type PrinterReadiness, PrintNotStartedError } from "@conveyor/shared";
import { poll } from "./poll.ts";
import { parseQuery } from "./query.ts";

const IDLE = new Set(["standby", "complete", "cancelled"]);

export function readinessOf(state: string | undefined): PrinterReadiness {
  if (state !== undefined && IDLE.has(state)) return "idle";
  if (state === "printing") return "printing";
  if (state === "paused") return "paused";
  if (state === "error") return "error";
  return "unknown";
}

export async function moonrakerReadiness(
  base: string,
  headers: Record<string, string>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<PrinterReadiness> {
  const res = await poll(`${base}/printer/objects/query?print_stats`, headers, timeoutMs, signal);
  if (typeof res === "string")
    throw new PrintNotStartedError(`moonraker idle check failed: ${res}`);
  try {
    return readinessOf(parseQuery(await res.json()).print_stats?.state);
  } catch (err) {
    throw new PrintNotStartedError(
      `moonraker idle check failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
