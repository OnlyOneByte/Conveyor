const HOST = /^[a-z0-9.-]+(:\d{1,5})?$/i;

export function withSocketSources(csp: string, host: string): string {
  if (!HOST.test(host)) return csp;
  return csp.replace(
    /(^|;\s*)connect-src ([^;]*)/,
    (_match, lead: string, sources: string) =>
      `${lead}connect-src ${sources} ws://${host} wss://${host}`,
  );
}
