import { queueMode } from "./mode.js";

let mode: string;
try {
  mode = queueMode(process.env);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
console.log(`conveyor worker queue: ${mode}`);
await import(mode === "sqlite" ? "./sqlite.js" : "./index.js");
