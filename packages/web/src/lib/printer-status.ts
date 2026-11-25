import type { JobView } from "@conveyor/shared";
import { ago } from "./ago";
import type { CatalogPrinter, PrinterReachable } from "./api";
import { named } from "./belt";
import type { Catalog } from "./catalog";
import { pillText } from "./job-live";
import { duration } from "./job-settings";

export type PrinterTone = "ready" | "busy" | "offline" | "checking";

export interface PrinterJob {
  id: string;
  name: string;
}

export interface PrinterCard {
  tone: PrinterTone;
  status: string;
  detail: string;
  job?: PrinterJob & { line: string; progress?: number };
  waiting: PrinterJob[];
}

export const REACH_MS = 60_000;

const STATUS: Record<PrinterTone, string> = {
  ready: "Ready",
  busy: "Busy",
  offline: "Offline",
  checking: "Checking",
};

const REASONS: [RegExp, string][] = [
  [/^timeout$/, "Didn't answer within 2 seconds."],
  [/^ECONNREFUSED$/, "Refused the connection. Is the printer's software running?"],
  [/^E(HOST|NET)UNREACH$/, "Isn't on the network."],
  [/^(ENOTFOUND|EAI_AGAIN)$/, "Its address doesn't resolve to a device."],
  [/^unparseable address/, "Its address isn't valid. Edit it to fix."],
];

export function unreachableText(reason: string | undefined): string {
  return REASONS.find(([pattern]) => pattern.test(reason ?? ""))?.[1] ?? "Didn't answer.";
}

const byAge = (a: JobView, b: JobView) =>
  (a.createdAt ?? 0) - (b.createdAt ?? 0) || a.jobId.localeCompare(b.jobId);

function jobOf(view: JobView, catalog: Catalog | null): PrinterJob {
  return { id: view.jobId, name: view.generator ? named(view.generator, catalog) : "Job" };
}

function runningLine(view: JobView): string {
  const left = view.print?.secondsLeft;
  return left === undefined ? pillText(view) : `${pillText(view)} · ${duration(left * 1000)} left`;
}

function lastSeen(printer: CatalogPrinter, now: number): string {
  return printer.lastSeenAt === undefined
    ? "It hasn't answered since it was added."
    : `Last answered ${ago(printer.lastSeenAt, now)}.`;
}

export function printerCard(
  printer: CatalogPrinter,
  reach: PrinterReachable | undefined,
  active: JobView[],
  catalog: Catalog | null,
  now: number,
): PrinterCard {
  const mine = active.filter((view) => view.printerId === printer.id).sort(byAge);
  const waiting = mine
    .filter((view) => view.state === "queued")
    .map((view) => jobOf(view, catalog));
  const running = mine.find((view) => view.state !== "queued");
  const tone: PrinterTone = running
    ? "busy"
    : !reach
      ? "checking"
      : reach.reachable
        ? "ready"
        : "offline";
  const card: PrinterCard = { tone, status: STATUS[tone], detail: "", waiting };
  if (running) {
    card.job = { ...jobOf(running, catalog), line: runningLine(running) };
    if (running.state === "printing" && running.progress !== undefined)
      card.job.progress = running.progress;
  } else if (tone === "checking") {
    card.detail = "Checking whether it answers…";
  } else if (reach?.reachable) {
    card.detail =
      reach.latencyMs === undefined
        ? "Connected."
        : `Connected, answered in ${reach.latencyMs} ms.`;
  } else {
    card.detail = `${unreachableText(reach?.reason)} ${lastSeen(printer, now)}`;
  }
  return card;
}

export function printersSummary(printers: CatalogPrinter[], active: JobView[]): string {
  const ids = new Set(printers.map((printer) => printer.id));
  const waiting = active.filter(
    (view) => view.state === "queued" && ids.has(view.printerId ?? ""),
  ).length;
  const count = `${printers.length} ${printers.length === 1 ? "printer" : "printers"}`;
  if (!waiting) return count;
  return `${count} · ${waiting} ${waiting === 1 ? "job" : "jobs"} waiting`;
}

export function limitsText(printer: CatalogPrinter, generators: Catalog["generators"]): string {
  const allowed = printer.allowedGenerators;
  if (allowed === undefined) return "Prints anything";
  if (!allowed.length) return "Prints nothing yet";
  const names = allowed.map((id) => generators.find((g) => g.id === id)?.name ?? id);
  return `Prints ${names.join(", ")} only`;
}
