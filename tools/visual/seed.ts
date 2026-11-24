import { join } from "node:path";
import type * as Db from "../../packages/shared/src/db/index.ts";

export const SEEDED_JOBS: Db.SettledJob[] = [
  {
    id: "seed-failed",
    generatorId: "gridfinity",
    params: { gridX: 1, gridY: 1, heightUnits: 3 },
    printerId: "elegoo-1",
    profileId: "orca/klipper-pla-0.2",
    state: "failed",
    stage: "transport",
    error: { stage: "transport", reason: "printer 192.0.2.50 did not answer within 10 s" },
  },
  {
    id: "seed-canceled",
    generatorId: "gridfinity",
    params: { gridX: 3, gridY: 2, heightUnits: 6 },
    printerId: "elegoo-1",
    profileId: "orca/klipper-pla-0.2",
    state: "canceled",
    stage: "slicer",
  },
  {
    id: "seed-printed",
    generatorId: "gridfinity",
    params: { gridX: 2, gridY: 3, heightUnits: 6, divisionsX: 2, magnetHoles: true },
    printerId: "elegoo-1",
    profileId: "orca/klipper-pla-0.2",
    state: "done",
    stage: "transport",
    modelPath: "/data/jobs/seed-printed/model.stl",
    gcodePath: "/data/jobs/seed-printed/model.gcode",
    timings: [
      { stage: "generator", enteredAt: 1795000000000, durationMs: 2000 },
      { stage: "slicer", enteredAt: 1795000002000, durationMs: 41000 },
      { stage: "transport", enteredAt: 1795000043000, durationMs: 4326000 },
    ],
    filament: { grams: 12.4, metres: 4.1 },
  },
];

export async function seedHistory(
  root: string,
  env: Record<string, string | undefined>,
): Promise<void> {
  const db: typeof Db = await import(join(root, "packages/shared/src/db/index.ts"));
  const conn = db.openDb(env.DB_PATH, env);
  try {
    for (const job of SEEDED_JOBS) db.dbRecordJob(conn, job);
  } finally {
    conn.close();
  }
}
