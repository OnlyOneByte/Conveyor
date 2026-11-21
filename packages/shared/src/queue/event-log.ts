import type { Database } from "bun:sqlite";
import type { JobStatusEvent } from "../events.js";

export function appendEvent(db: Database, event: JobStatusEvent): void {
  db.query("INSERT INTO job_events (job_id, event, at) VALUES (?, ?, ?)").run(
    event.jobId,
    JSON.stringify(event),
    event.at,
  );
}
