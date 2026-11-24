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
    error: {
      stage: "transport",
      reason: "elegoo upload failed: Unable to connect. Is the computer able to access the url?",
    },
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
  const first = Date.now() - SEEDED_JOBS.length * 1000;
  const settle = conn.prepare("UPDATE jobs SET created_at = ?1, updated_at = ?1 WHERE id = ?2");
  try {
    for (const [i, job] of SEEDED_JOBS.entries()) {
      db.dbRecordJob(conn, job);
      settle.run(first + i * 1000, job.id);
    }
  } finally {
    conn.close();
  }
}
