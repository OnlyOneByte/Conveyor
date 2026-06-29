// Thin client over the Conveyor API. Same-origin in prod (Caddy), proxied in dev (vite).
import type { JobState } from "@conveyor/shared";

export interface StationSummary {
  id: string;
  name: string;
  allowedGenerators?: string[];
}

export interface GeneratorSummary {
  id: string;
  name: string;
  paramSchema: Record<string, unknown>;
  preview?: { kind: string; module: string };
  outputs: string[];
}

export interface JobStatusEvent {
  jobId: string;
  state: JobState;
  stage?: string | null;
  progress?: number;
  message?: string;
  error?: { stage: string; reason: string };
  at: number;
}

export async function fetchStations(fetchFn: typeof fetch = fetch): Promise<StationSummary[]> {
  const r = await fetchFn("/stations");
  if (!r.ok) throw new Error(`GET /stations ${r.status}`);
  return r.json();
}

export async function fetchGenerators(fetchFn: typeof fetch = fetch): Promise<GeneratorSummary[]> {
  const r = await fetchFn("/generators");
  if (!r.ok) throw new Error(`GET /generators ${r.status}`);
  return r.json();
}

export async function submitJob(
  body: { generator: { id: string; params: unknown }; stationId: string },
): Promise<{ jobId: string }> {
  const r = await fetch("/jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `POST /jobs ${r.status}`);
  }
  return r.json();
}

/** Open the job status WebSocket. Caller handles events + close. */
export function openJobSocket(jobId: string): WebSocket {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return new WebSocket(`${proto}://${location.host}/jobs/${jobId}/ws`);
}

export async function fetchJobSnapshot(jobId: string): Promise<JobStatusEvent | null> {
  const r = await fetch(`/jobs/${jobId}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GET /jobs/${jobId} ${r.status}`);
  return r.json();
}
