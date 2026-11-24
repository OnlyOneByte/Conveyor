export type JsonRead = { ok: true; value: unknown } | { ok: false };

export function readJson(text: string): JsonRead {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}
