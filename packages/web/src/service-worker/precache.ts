const SKIPPED = [
  /\.wasm$/,
  /(^|\/)draco_[^/]*$/,
  /(^|\/)basis_[^/]*$/,
  /\.woff$/,
  /-(latin-ext|vietnamese|cyrillic(-ext)?|greek(-ext)?)-[^/]*\.woff2$/,
];

export const precached = (paths: string[], onDemand: string[] = []): string[] =>
  paths
    .map((path) => (path.startsWith("/") ? path : `/${path}`))
    .filter((path) => !SKIPPED.some((skip) => skip.test(path)) && !onDemand.includes(path));

interface Store {
  match(request: Request, options: { ignoreVary: boolean }): Promise<Response | undefined>;
}

export const fromCache = (
  request: Request,
  store: Store,
  network: (request: Request) => Promise<Response>,
): Promise<Response> =>
  store.match(request, { ignoreVary: true }).then((hit) => hit ?? network(request));
