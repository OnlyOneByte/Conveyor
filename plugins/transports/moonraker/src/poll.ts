import { StageError } from "@conveyor/shared";
import {
  PrinterNameUnresolvedError,
  pinnedUrl,
  refuseRedirect,
  requirePrinterAddress,
} from "@conveyor/shared/node";

export interface Reach {
  base: string;
  headers: Record<string, string>;
}

export async function reach(
  address: string,
  base: string,
  headers: Record<string, string>,
): Promise<Reach> {
  const pin = pinnedUrl(base, await requirePrinterAddress(address));
  return { base: pin.url, headers: pin.host ? { ...headers, Host: pin.host } : headers };
}

export async function unresolved(
  address: string,
  base: string,
  headers: Record<string, string>,
): Promise<string | Reach> {
  try {
    return await reach(address, base, headers);
  } catch (err) {
    if (err instanceof StageError && err.cause instanceof PrinterNameUnresolvedError)
      return err.reason;
    throw err;
  }
}

export function positiveSetting(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0)
    throw new StageError("transport", `${name} must be a whole number above 0, got ${raw}`);
  return value;
}

export async function poll(
  query: string,
  headers: Record<string, string>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Response | string> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const res = await fetch(query, {
    headers,
    redirect: "manual",
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  }).catch((e: unknown) => (e instanceof Error ? e.message : String(e)));
  if (typeof res === "string" || res.ok) return res;
  refuseRedirect(res, "moonraker status query");
  return String(res.status);
}
