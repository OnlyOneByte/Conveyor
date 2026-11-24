import { describe, expect, test } from "bun:test";
import type { CatalogPrinter, JobHistoryEntry } from "./api";
import type { Catalog } from "./catalog";
import { jobCommands, matchCommands, printerCommands } from "./commands";

const voron: CatalogPrinter = {
  id: "voron-garage",
  transportId: "moonraker",
  name: "Voron 2.4",
  address: "192.0.2.9",
  hasSecrets: false,
};

const catalog: Catalog = {
  printers: [voron],
  generators: [
    {
      id: "gridfinity",
      name: "Gridfinity Bin",
      outputs: [],
      paramSchema: { properties: { gridX: { type: "integer" }, gridY: { type: "integer" } } },
      ui: { groups: [{ title: "Footprint", fields: ["gridX", "gridY"], layout: "pair" }] },
    },
  ],
};

const NOW = Date.UTC(2026, 0, 2, 12);

const job = (
  id: string,
  generator: JobHistoryEntry["request"]["generator"],
  state: JobHistoryEntry["state"],
  updatedAt = NOW - 3 * 60_000,
) => ({
  id,
  request: { generator, printerId: "voron-garage", profileId: "orca/klipper-pla-0.2" },
  state,
  createdAt: 1,
  updatedAt,
});

const jobs: JobHistoryEntry[] = [
  job(
    "1a2b3c4d-0000-4000-8000-000000000001",
    { id: "gridfinity", params: { gridX: 2, gridY: 3 } },
    "done",
  ),
  job(
    "1a2b3c4d-0000-4000-8000-000000000002",
    { id: "passthrough", params: { uploadId: "u1", filename: "bracket.stl" } },
    "failed",
  ),
];

describe("the command menu's jobs and printers", () => {
  test("names jobs like the belt and the receipt, with the printer and a plain state", () => {
    const opened: string[] = [];
    const commands = jobCommands(jobs, catalog, (id) => opened.push(id), NOW);
    expect(commands.map((c) => [c.label, c.hint])).toEqual([
      ["Gridfinity Bin 2×3", "Voron 2.4 · Printed · 3m ago"],
      ["bracket.stl", "Voron 2.4 · Failed · 3m ago"],
    ]);
    commands[1]?.run();
    expect(opened).toEqual([jobs[1]?.id]);
  });

  test("shows no raw generator, printer, transport or job id in any option", () => {
    const options = [
      ...jobCommands(jobs, catalog, () => {}),
      ...printerCommands([voron], () => {}),
    ];
    const text = options.map((c) => `${c.label} ${c.hint}`).join(" | ");
    for (const raw of [
      "gridfinity",
      "passthrough",
      "voron-garage",
      "moonraker",
      "1a2b3c4d",
      "orca/",
    ]) {
      expect(text).not.toContain(raw);
    }
  });

  test("still names a job when the catalog can't be read", () => {
    const commands = jobCommands(jobs.slice(0, 1), null, () => {}, NOW);
    expect(commands.map((c) => [c.label, c.hint])).toEqual([["Gridfinity", "Printed · 3m ago"]]);
  });

  test("tells identical jobs apart by when they finished", () => {
    const bin = { id: "gridfinity", params: { gridX: 2, gridY: 3 } };
    const twins = [
      job("1a2b3c4d-0000-4000-8000-000000000003", bin, "done", NOW - 30_000),
      job("1a2b3c4d-0000-4000-8000-000000000004", bin, "done", NOW - 2 * 3_600_000),
      job("1a2b3c4d-0000-4000-8000-000000000005", bin, "done", NOW - 3 * 86_400_000),
    ];
    expect(jobCommands(twins, catalog, () => {}, NOW).map((c) => c.hint)).toEqual([
      "Voron 2.4 · Printed · just now",
      "Voron 2.4 · Printed · 2h ago",
      "Voron 2.4 · Printed · 3d ago",
    ]);
  });
});

describe("matchCommands", () => {
  const commands = jobCommands(jobs, catalog, () => {}, NOW);
  const labels = (query: string) => matchCommands(commands, query).map((c) => c.label);

  test("finds a job by the state's old word as well as its plain one", () => {
    expect(labels("done")).toEqual(["Gridfinity Bin 2×3"]);
    expect(labels("printed")).toEqual(["Gridfinity Bin 2×3"]);
    expect(labels("failed")).toEqual(["bracket.stl"]);
  });

  test("matches a footprint typed with x, ×, or spaces", () => {
    for (const query of ["2x3", "2X3", "2 x 3", "2×3", "bin 2 × 3"]) {
      expect(labels(query)).toEqual(["Gridfinity Bin 2×3"]);
    }
    expect(labels("3x2")).toEqual([]);
  });
});
