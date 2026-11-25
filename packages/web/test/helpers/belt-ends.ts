import type { Politeness } from "../../src/lib/announce";
import type { JobHistoryEntry } from "../../src/lib/api";
import { createEnds, type EndsFeed } from "../../src/lib/belt-ends";
import { Unreachable } from "../../src/lib/http-error";
import type { Retried } from "../../src/lib/retry";
import type { TrackJob } from "../../src/lib/track";

export const NOW = new Date(2026, 10, 24, 15, 0);
export const at = (hours: number) => new Date(2026, 10, 24, hours).getTime();
export const request = {
  generator: { id: "gridfinity", params: { gridX: 2, gridY: 3 } },
  printerId: "voron",
  profileId: "pla",
};
export const entry = (
  id: string,
  state: JobHistoryEntry["state"],
  updatedAt = at(9),
  extra: Partial<JobHistoryEntry> = {},
): JobHistoryEntry => ({ id, request, state, createdAt: updatedAt, updatedAt, ...extra });
export const catalog = {
  printers: [
    {
      id: "voron",
      name: "Voron 2.4",
      transportId: "klipper",
      address: "192.0.2.9",
      hasSecrets: false,
    },
    {
      id: "prusa",
      name: "Prusa",
      transportId: "prusalink",
      address: "192.0.2.10",
      hasSecrets: false,
      allowedGenerators: ["passthrough"],
    },
    {
      id: "ender",
      name: "Ender 3",
      transportId: "klipper",
      address: "192.0.2.11",
      hasSecrets: false,
    },
  ],
  generators: [
    {
      id: "gridfinity",
      name: "Gridfinity Bin",
      outputs: [],
      paramSchema: { properties: { gridX: { type: "integer" }, gridY: { type: "integer" } } },
      ui: { groups: [{ title: "Footprint", fields: ["gridX", "gridY"], layout: "pair" as const }] },
    },
  ],
};
export const job: TrackJob = {
  id: "f1",
  name: "Gridfinity Bin 2×3",
  state: "failed",
  printer: "Voron 2.4",
};

export function rig(refuse: string[] = [], retried: Retried = { ok: true, jobId: "j2" }) {
  const calls: string[] = [];
  const said: [string, Politeness][] = [];
  const shown: [number, TrackJob[]][] = [];
  const toasts: { text: string; action?: { label: string; run: () => void } }[] = [];
  const picked: unknown[] = [];
  const downs: boolean[] = [];
  const upload = {
    ...request,
    generator: { id: "passthrough", params: { uploadId: "u1", filename: "clip.stl" } },
  };
  const records = new Map<string, JobHistoryEntry>();
  const call = (name: string) => async (arg?: unknown) => {
    calls.push(`${name} ${JSON.stringify(arg)}`);
    if (refuse.includes(name)) throw new Error("409");
  };
  const feed: EndsFeed = {
    finished: async (since) => {
      calls.push(`finished ${since}`);
      if (refuse.includes("finished")) throw new Unreachable("GET /jobs-history/counts 503");
      if (refuse.includes("locked")) throw new Error("database is locked");
      return 4;
    },
    needsYou: async () => [
      entry("f1", "failed", at(9), {
        error: { stage: "transport", reason: "the printer didn't answer" },
      }),
    ],
    entry: async (id) => records.get(id) ?? null,
    submit: call("submit"),
    retry: async (failed) => {
      await call("retry")(failed.id);
      return retried;
    },
    dismiss: call("dismiss"),
    cancel: call("cancel"),
    catalog: async () => catalog,
  };
  const ends = createEnds(
    feed,
    {
      show: (finished, needs) => shown.push([finished, needs]),
      toast: (text, action) => toasts.push(action ? { text, action } : { text }),
      say: (text, level) => said.push([text, level]),
      pick: (asked, retryOf) => picked.push([asked, retryOf]),
      down: (down) => downs.push(down),
    },
    { now: () => NOW },
  );
  return { calls, said, shown, toasts, picked, ends, records, upload, downs };
}
