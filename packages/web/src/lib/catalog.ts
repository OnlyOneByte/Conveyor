import { type CatalogPrinter, fetchCatalogPrinters, fetchGenerators, type GeneratorSummary } from "./api";

export const CATALOG_MS = 60000;

export interface Catalog {
  printers: CatalogPrinter[];
  generators: GeneratorSummary[];
}

let cached: { at: number; catalog: Promise<Catalog> } | undefined;

export function loadCatalog(now = Date.now()): Promise<Catalog> {
  if (cached && now >= cached.at && now - cached.at < CATALOG_MS) return cached.catalog;
  const catalog = Promise.all([fetchCatalogPrinters(), fetchGenerators()]).then(([printers, generators]) => ({ printers, generators }));
  cached = { at: now, catalog };
  catalog.catch(() => (cached = undefined));
  return catalog;
}
