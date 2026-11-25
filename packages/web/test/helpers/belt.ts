import type { JobStatusEvent, JobView } from "@conveyor/shared";
import { createBelt, type Feed, type Socket } from "../../src/lib/belt";
import type { News } from "../../src/lib/belt-news";
import type { Catalog } from "../../src/lib/catalog";
import type { TrackJob } from "../../src/lib/track";

export const catalog: Catalog = {
  printers: [
    {
      id: "voron",
      name: "Voron 2.4",
      transportId: "klipper",
      address: "192.0.2.9",
      hasSecrets: false,
    },
  ],
  generators: [
    {
      id: "gridfinity",
      name: "Gridfinity Bin",
      outputs: [],
      paramSchema: {
        properties: {
          gridX: { type: "integer" },
          gridY: { type: "integer" },
          heightUnits: { type: "integer" },
        },
      },
      ui: {
        groups: [
          { title: "Footprint", fields: ["gridX", "gridY"], layout: "pair" },
          { title: "Height", fields: ["heightUnits"], layout: "stack" },
        ],
        unitMm: { heightUnits: 7 },
      },
    },
  ],
};

export const view = (
  jobId: string,
  state: JobView["state"],
  extra: Partial<JobView> = {},
): JobView => ({
  jobId,
  state,
  at: 1,
  printerId: "voron",
  profileId: "pla",
  generator: { id: "gridfinity", params: { gridX: 2, gridY: 3, heightUnits: 6 } },
  createdAt: 1,
  ...extra,
});

export function rig() {
  const state: {
    active: JobView[] | null;
    final: Map<string, JobView | Error>;
    catalog: Catalog | null;
  } = { active: [], final: new Map(), catalog };
  const sockets = new Map<string, Socket & { closed: boolean }>();
  const shown: TrackJob[][] = [];
  const told: News[] = [];
  const feed: Feed = {
    active: async () => {
      if (!state.active) throw new Error("401");
      return state.active;
    },
    final: async (id) => {
      const found = state.final.get(id);
      if (found instanceof Error) throw found;
      return found ?? null;
    },
    catalog: async () => {
      if (!state.catalog) throw new Error("down");
      return state.catalog;
    },
    socket: (id) => {
      const socket: Socket & { closed: boolean } = {
        onmessage: null,
        onclose: null,
        closed: false,
        close: () => (socket.closed = true),
      };
      sockets.set(id, socket);
      return socket;
    },
    clock: () => "14:05",
  };
  const ended: TrackJob[][] = [];
  const offline: boolean[] = [];
  const belt = createBelt(
    feed,
    (jobs, gone, down) => {
      shown.push(jobs);
      ended.push(gone);
      offline.push(down);
    },
    (news) => told.push(...news),
  );
  const send = (event: JobStatusEvent, to = event.jobId) =>
    sockets.get(to)?.onmessage?.(new MessageEvent("message", { data: JSON.stringify(event) }));
  return { state, sockets, shown, ended, offline, told, belt, send };
}
