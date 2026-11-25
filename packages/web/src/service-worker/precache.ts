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
