export interface ErrorSource {
  on(event: "error", listener: (err: Error) => void): unknown;
}

export function logErrors<T extends ErrorSource>(
  source: T,
  name: string,
  log: (line: string) => void = console.error,
): T {
  source.on("error", (err) => log(`[redis] ${name}: ${err.message}`));
  return source;
}
