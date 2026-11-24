import type { CatalogPrinter, JobHistoryEntry } from "./api";
import { named } from "./belt";
import type { Catalog } from "./catalog";

export interface Command {
  group: "Jobs" | "Actions" | "Printers";
  label: string;
  hint: string;
  run: () => void;
}

const ORDER: Command["group"][] = ["Jobs", "Actions", "Printers"];

export function matchCommands(all: Command[], query: string): Command[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = all.filter((c) =>
    words.every((w) => `${c.label} ${c.hint}`.toLowerCase().includes(w)),
  );
  return ORDER.flatMap((group) => hits.filter((c) => c.group === group));
}

const SETTLED: Record<string, string> = { done: "Printed", failed: "Failed", canceled: "Canceled" };

export function jobCommands(
  jobs: JobHistoryEntry[],
  catalog: Catalog | null,
  open: (id: string) => void,
): Command[] {
  return jobs.slice(0, 8).map((job) => {
    const printer = catalog?.printers.find((p) => p.id === job.request.printerId)?.name;
    const hint = [printer, SETTLED[job.state]].filter(Boolean).join(" · ");
    return {
      group: "Jobs",
      label: named(job.request.generator, catalog),
      hint,
      run: () => open(job.id),
    };
  });
}

export const printerCommands = (printers: CatalogPrinter[], open: () => void): Command[] =>
  printers.map((p) => ({ group: "Printers", label: p.name, hint: "", run: open }));
