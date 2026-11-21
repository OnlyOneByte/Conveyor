import { queueMode, workerConcurrency } from "./mode.js";

let mode: string;
let concurrency = 0;
try {
  mode = queueMode(process.env);
  if (mode === "sqlite") concurrency = workerConcurrency(process.env);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
console.log(`conveyor worker queue: ${mode}`);
if (mode === "sqlite") {
  const { startSqliteWorker } = await import("./sqlite.js");
  const worker = startSqliteWorker(process.env, concurrency);
  console.log("conveyor worker ready");
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => {
      console.log(`${signal}: releasing running jobs`);
      void worker.stop().then(() => process.exit(0));
    });
  }
} else {
  await import("./index.js");
}
