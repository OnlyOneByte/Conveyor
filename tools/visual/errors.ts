export function messageOf(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text.split("\n")[0];
}
