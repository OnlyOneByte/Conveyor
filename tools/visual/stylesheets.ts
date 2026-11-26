export interface StylesheetRoute<R> {
  fetch(): Promise<R>;
  fulfill(options: { response: R }): Promise<void>;
  abort(errorCode?: string): Promise<void>;
}

export interface RoutesStylesheets<R> {
  route(
    match: (url: URL) => boolean,
    handler: (route: StylesheetRoute<R>) => unknown,
  ): Promise<unknown>;
}

export const isStylesheet = (url: URL) => url.pathname.endsWith(".css");

export async function serveStylesheet<R>(route: StylesheetRoute<R>): Promise<void> {
  const response = await route
    .fetch()
    .catch(() => route.fetch())
    .catch(() => undefined);
  if (response === undefined) return route.abort("failed");
  return route.fulfill({ response });
}

export async function fetchStylesheets<R>(context: RoutesStylesheets<R>): Promise<void> {
  await context.route(isStylesheet, serveStylesheet);
}
