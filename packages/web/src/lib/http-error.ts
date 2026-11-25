const GATEWAY = new Set([502, 503, 504]);

export class Unreachable extends Error {}

export const unreachable = (e: unknown) => e instanceof TypeError || e instanceof Unreachable;

export async function failure(r: Response, label: string): Promise<Error> {
  const fallback = `${label} ${r.status}`;
  if (GATEWAY.has(r.status)) return new Unreachable(fallback);
  const body: unknown = await r.json().catch(() => null);
  const error = body && typeof body === "object" && "error" in body ? body.error : null;
  return new Error(typeof error === "string" && error ? error : fallback);
}
