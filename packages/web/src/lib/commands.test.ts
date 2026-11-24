import { describe, expect, test } from "bun:test";
import type { CatalogPrinter, JobHistoryEntry } from "./api";
import type { Catalog } from "./catalog";
import { jobCommands, printerCommands } from "./commands";

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

const job = (
  id: string,
  generator: JobHistoryEntry["request"]["generator"],
  state: JobHistoryEntry["state"],
) => ({
  id,
  request: { generator, printerId: "voron-garage", profileId: "orca/klipper-pla-0.2" },
  state,
  createdAt: 1,
  updatedAt: 2,
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
    const commands = jobCommands(jobs, catalog, (id) => opened.push(id));
    expect(commands.map((c) => [c.label, c.hint])).toEqual([
      ["Gridfinity Bin 2x3", "Voron 2.4 · Printed"],
      ["bracket.stl", "Voron 2.4 · Failed"],
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
    expect(jobCommands(jobs.slice(0, 1), null, () => {}).map((c) => [c.label, c.hint])).toEqual([
      ["Gridfinity", "Printed"],
    ]);
  });
});
