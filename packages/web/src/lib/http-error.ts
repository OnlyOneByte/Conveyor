const GATEWAY = new Set([502, 503, 504]);
export const MESSAGE_MAX = 300;

export const shown = (text: string) => {
  const trimmed = text.trim();
  return trimmed.length > MESSAGE_MAX ? `${trimmed.slice(0, MESSAGE_MAX - 1).trimEnd()}…` : trimmed;
};

export class Unreachable extends Error {}

export const unreachable = (e: unknown) => e instanceof TypeError || e instanceof Unreachable;

export const statusError = (r: Response, label: string): Error =>
  GATEWAY.has(r.status)
    ? new Unreachable(`${label} ${r.status}`)
    : new Error(`${label} ${r.status}`);

export class FieldError extends Error {
  constructor(
    message: string,
    readonly field: string,
  ) {
    super(message);
  }
}

export const fieldOf = (e: unknown) => (e instanceof FieldError ? e.field : null);

export async function failure(r: Response, label: string): Promise<Error> {
  const fallback = `${label} ${r.status}`;
  if (GATEWAY.has(r.status)) return new Unreachable(fallback);
  const body: unknown = await r.json().catch(() => null);
  const read = (key: string) =>
    body && typeof body === "object" && key in body ? Reflect.get(body, key) : null;
  const error = read("error");
  const field = read("field");
  const message = (typeof error === "string" ? shown(error) : "") || fallback;
  return typeof field === "string" && field ? new FieldError(message, field) : new Error(message);
}
