import { ago } from "./ago";
import type { CatalogPrinter, JobHistoryEntry } from "./api";
import { named } from "./belt";
import type { Catalog } from "./catalog";

export interface Command {
  group: "Jobs" | "Actions" | "Printers";
  label: string;
  hint: string;
  terms?: string;
  run: () => void;
}

const ORDER: Command["group"][] = ["Jobs", "Actions", "Printers"];

const plain = (text: string) => text.toLowerCase().replace(/(\d)\s*[x×]\s*(\d)/g, "$1x$2");

export function matchCommands(all: Command[], query: string): Command[] {
  const words = plain(query).split(/\s+/).filter(Boolean);
  const hits = all.filter((c) => {
    const text = plain(`${c.label} ${c.hint} ${c.terms ?? ""}`);
    return words.every((w) => text.includes(w));
  });
  return ORDER.flatMap((group) => hits.filter((c) => c.group === group));
}

const SETTLED: Record<string, string> = { done: "Printed", failed: "Failed", canceled: "Canceled" };

export function jobCommands(
  jobs: JobHistoryEntry[],
  catalog: Catalog | null,
  open: (id: string) => void,
  now = Date.now(),
): Command[] {
  return jobs.slice(0, 8).map((job) => {
    const printer = catalog?.printers.find((p) => p.id === job.request.printerId)?.name;
    const hint = [printer, SETTLED[job.state], ago(job.updatedAt, now)].filter(Boolean).join(" · ");
    return {
      group: "Jobs",
      label: named(job.request.generator, catalog),
      hint,
      terms: job.state,
      run: () => open(job.id),
    };
  });
}

export const printerCommands = (printers: CatalogPrinter[], open: () => void): Command[] =>
  printers.map((p) => ({ group: "Printers", label: p.name, hint: "", run: open }));
