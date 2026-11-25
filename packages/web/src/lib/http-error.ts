const GATEWAY = new Set([502, 503, 504]);
export const MESSAGE_MAX = 300;

export const shown = (text: string) => {
  const trimmed = text.trim();
  return trimmed.length > MESSAGE_MAX ? `${trimmed.slice(0, MESSAGE_MAX - 1).trimEnd()}…` : trimmed;
};

export class Unreachable extends Error {}

export const unreachable = (e: unknown) => e instanceof TypeError || e instanceof Unreachable;

export async function failure(r: Response, label: string): Promise<Error> {
  const fallback = `${label} ${r.status}`;
  if (GATEWAY.has(r.status)) return new Unreachable(fallback);
  const body: unknown = await r.json().catch(() => null);
  const error = body && typeof body === "object" && "error" in body ? body.error : null;
  const message = typeof error === "string" ? shown(error) : "";
  return new Error(message || fallback);
}
