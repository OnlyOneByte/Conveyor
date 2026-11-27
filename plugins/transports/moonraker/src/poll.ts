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

function requireHttp(address: string): void {
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(address.trim())?.[1]?.toLowerCase();
  if (scheme === undefined || scheme === "http" || scheme === "https") return;
  throw new StageError(
    "transport",
    `Conveyor connects to Moonraker printers only over http or https, not ${scheme}://. Write the address as host:port, or as an http or https URL.`,
  );
}

export async function reach(
  address: string,
  toBase: (address: string) => string,
  headers: Record<string, string>,
): Promise<Reach> {
  const ip = await requirePrinterAddress(address);
  requireHttp(address);
  const pin = pinnedUrl(toBase(address), ip);
  return { base: pin.url, headers: pin.host ? { ...headers, Host: pin.host } : headers };
}

export async function unresolved(
  address: string,
  toBase: (address: string) => string,
  headers: Record<string, string>,
): Promise<string | Reach> {
  try {
    return await reach(address, toBase, headers);
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
