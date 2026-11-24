import { describe, expect, test } from "bun:test";
import type { JobView } from "@conveyor/shared";
import type { CatalogPrinter } from "./api";
import { limitsText, printerCard, printersSummary, unreachableText } from "./printer-status";

const NOW = Date.UTC(2026, 0, 1, 13);
const voron: CatalogPrinter = { id: "voron", transportId: "moonraker", name: "Voron 2.4", address: "10.0.0.5", hasSecrets: false };
const catalog = { printers: [voron], generators: [{ id: "gridfinity", name: "Gridfinity Bin", paramSchema: {}, outputs: ["stl"] }] };
const job = (jobId: string, state: JobView["state"], extra: Partial<JobView> = {}): JobView => ({
  jobId,
  state,
  at: NOW,
  printerId: "voron",
  generator: { id: "gridfinity" },
  ...extra,
});

describe("printerCard", () => {
  test("a printer with a running job is busy, with the job, its progress and the time left", () => {
    const printing = job("a", "printing", { progress: 0.64, print: { secondsLeft: 2460 } });
    const card = printerCard(voron, { reachable: false, host: "", port: 0 }, [printing], catalog, NOW);
    expect(card).toMatchObject({ tone: "busy", status: "Busy", waiting: [] });
    expect(card.job).toEqual({ id: "a", name: "Gridfinity Bin", line: "Printing · 64% · 41 min left", progress: 0.64 });
  });

  test("a job still slicing shows no bar and no time left", () => {
    const card = printerCard(voron, undefined, [job("a", "slicing", { progress: 0.5 })], catalog, NOW);
    expect(card.job).toEqual({ id: "a", name: "Gridfinity Bin", line: "Slicing · 50%" });
  });

  test("waiting jobs are listed oldest first, and other printers' jobs are ignored", () => {
    const active = [
      job("late", "queued", { createdAt: 20 }),
      job("other", "queued", { printerId: "elegoo" }),
      job("early", "queued", { createdAt: 10, generator: undefined }),
    ];
    const card = printerCard(voron, { reachable: true, latencyMs: 12, host: "", port: 0 }, active, catalog, NOW);
    expect(card).toMatchObject({ tone: "ready", status: "Ready", detail: "Answered in 12 ms." });
    expect(card.waiting).toEqual([
      { id: "early", name: "Job" },
      { id: "late", name: "Gridfinity Bin" },
    ]);
  });

  test("a printer that hasn't been probed yet is checking", () => {
    expect(printerCard(voron, undefined, [], null, NOW)).toMatchObject({ tone: "checking", status: "Checking" });
  });

  test("an offline printer says why in plain words and when it last answered", () => {
    const seen = { ...voron, lastSeenAt: NOW - 3 * 3600_000 };
    const down = { reachable: false, host: "10.0.0.5", port: 80, reason: "timeout" };
    expect(printerCard(seen, down, [], null, NOW)).toMatchObject({
      tone: "offline",
      status: "Offline",
      detail: "Didn't answer within 2 seconds. Last answered 3h ago.",
    });
    expect(printerCard(voron, { ...down, reason: "ECONNREFUSED" }, [], null, NOW).detail).toBe(
      "Refused the connection. Is Moonraker or ElegooLink running? It hasn't answered since it was added.",
    );
  });

  test("a reachable printer without a latency answered just now", () => {
    expect(printerCard(voron, { reachable: true, host: "", port: 0 }, [], null, NOW).detail).toBe("Answered just now.");
  });
});

describe("unreachableText", () => {
  test.each([
    ["EHOSTUNREACH", "Isn't on the network."],
    ["ENETUNREACH", "Isn't on the network."],
    ["ENOTFOUND", "Its address doesn't resolve to a device."],
    ["unparseable address: bad port", "Its address isn't valid. Edit it to fix."],
    ["EPIPE", "Didn't answer."],
    [undefined, "Didn't answer."],
  ])("%p reads %p", (reason, text) => {
    expect(unreachableText(reason)).toBe(text);
  });
});

describe("printersSummary", () => {
  test("counts printers and the jobs waiting for them", () => {
    expect(printersSummary([voron], [])).toBe("1 printer");
    const active = [job("a", "queued"), job("b", "printing"), job("c", "queued", { printerId: "gone" })];
    expect(printersSummary([voron, { ...voron, id: "two" }], active)).toBe("2 printers · 1 job waiting");
    expect(printersSummary([voron], [job("a", "queued"), job("b", "queued")])).toBe("1 printer · 2 jobs waiting");
  });
});

describe("limitsText", () => {
  test("names the generators a restricted printer takes", () => {
    expect(limitsText(voron, catalog.generators)).toBe("Prints anything");
    expect(limitsText({ ...voron, allowedGenerators: [] }, catalog.generators)).toBe("Prints nothing yet");
    expect(limitsText({ ...voron, allowedGenerators: ["gridfinity", "gone"] }, catalog.generators)).toBe(
      "Prints Gridfinity Bin, gone only",
    );
  });
});
