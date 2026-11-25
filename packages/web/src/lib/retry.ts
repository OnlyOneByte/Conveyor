import { API, type JobHistoryEntry } from "./api";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

export type Retried =
  | { ok: true; jobId: string }
  | { ok: false; status: number; error: string; retriedBy?: string };

export async function retryJob(
  failed: Pick<JobHistoryEntry, "id" | "request">,
  fetchFn: typeof fetch = fetch,
): Promise<Retried> {
  const r = await fetchFn(`${API}/jobs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...failed.request, retryOf: failed.id }),
  });
  const body: unknown = await r.json().catch(() => null);
  const text = (key: string) => {
    const value = isRecord(body) ? body[key] : undefined;
    return typeof value === "string" ? value : undefined;
  };
  const jobId = text("jobId");
  if (r.ok && jobId) return { ok: true, jobId };
  const retriedBy = text("retriedBy");
  const error = text("error") ?? `POST /jobs ${r.status}`;
  const refused = { ok: false as const, status: r.status, error };
  return retriedBy ? { ...refused, retriedBy } : refused;
}
