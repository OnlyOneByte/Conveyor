// Thin client over the Conveyor API. Same-origin in prod (Caddy), proxied in dev (vite).
import type {
  FormUiHints,
  JobState,
  OrcaEditableProfile,
  OrcaProfileDocuments,
} from "@conveyor/shared";

export interface GeneratorSummary {
  id: string;
  name: string;
  paramSchema: Record<string, unknown>;
  /** optional grouping / advanced / control hints for the generated form */
  ui?: FormUiHints;
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

export async function fetchGenerators(fetchFn: typeof fetch = fetch): Promise<GeneratorSummary[]> {
  const r = await fetchFn("/generators");
  if (!r.ok) throw new Error(`GET /generators ${r.status}`);
  return r.json();
}

export interface UploadResult {
  uploadId: string;
  filename: string;
  bytes: number;
}

/** Upload an STL for the passthrough generator. Returns an opaque uploadId. */
export async function uploadStl(file: File): Promise<UploadResult> {
  const form = new FormData();
  form.append("file", file, file.name);
  const r = await fetch("/uploads", { method: "POST", body: form });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `POST /uploads ${r.status}`);
  }
  return r.json();
}

export async function submitJob(
  body: { generator: { id: string; params: unknown }; printerId: string; profileId: string },
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

// ─── Auth ───────────────────────────────────────────────────────────────────
// One tier: holding the password grants the whole app. No roles.
export interface AuthStatus {
  authEnabled: boolean;
  authenticated: boolean;
}

export async function fetchAuthStatus(fetchFn: typeof fetch = fetch): Promise<AuthStatus> {
  const r = await fetchFn("/auth/status");
  if (!r.ok) throw new Error(`GET /auth/status ${r.status}`);
  return r.json();
}

export async function login(password: string): Promise<void> {
  const r = await fetch("/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `login failed (${r.status})`);
  }
}

export async function logout(): Promise<void> {
  await fetch("/auth/logout", { method: "POST" });
}

// ─── Catalog (printers / profiles) ──────────────────────────────────────────
export interface CatalogPrinter {
  id: string;
  transportId: string;
  name: string;
  address: string;
  hasSecrets: boolean;
  /** generator ids this printer accepts; undefined = no restriction, [] = none */
  allowedGenerators?: string[];
}
export interface CatalogProfile {
  id: string;
  slicerId: string;
  name: string;
  path: string;
  gcodeFlavor: string;
  hasEditableContent?: boolean;
}

export interface OrcaProfileContent extends OrcaEditableProfile {
  source: "bundled" | "edited";
}
export interface JobHistoryEntry {
  id: string;
  /** printerId/profileId may be "" on a job migrated from a deleted station */
  request: { generator: { id: string; params?: unknown }; printerId: string; profileId: string };
  state: JobState;
  stage?: string | null;
  error?: { stage: string; reason: string };
  artifacts?: { model?: string; gcode?: string };
  createdAt: number;
  updatedAt: number;
}

async function getJson<T>(path: string, fetchFn: typeof fetch = fetch): Promise<T> {
  const r = await fetchFn(path);
  if (!r.ok) throw new Error(`GET ${path} ${r.status}`);
  return r.json();
}
async function putJson(path: string, body: unknown): Promise<void> {
  const r = await fetch(path, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    const msg = (err as { error?: unknown }).error;
    throw new Error(typeof msg === "string" ? msg : `PUT ${path} ${r.status}`);
  }
}

export const fetchCatalogPrinters = (f?: typeof fetch) => getJson<CatalogPrinter[]>("/catalog/printers", f);
export interface CatalogTransport {
  id: string;
  name: string;
  acceptsFlavors: string[];
}

export const fetchCatalogTransports = (f?: typeof fetch) =>
  getJson<CatalogTransport[]>("/catalog/transports", f);
export const fetchCatalogProfiles = (f?: typeof fetch) => getJson<CatalogProfile[]>("/catalog/profiles", f);

export async function fetchOrcaProfileContent(
  id: string,
  fetchFn: typeof fetch = fetch,
): Promise<OrcaProfileContent> {
  const path = `/catalog/profiles/${encodeURIComponent(id)}/content`;
  const r = await fetchFn(path);
  if (!r.ok) {
    const body = (await r.json().catch(() => ({}))) as { error?: unknown };
    throw new Error(typeof body.error === "string" ? body.error : `GET ${path} ${r.status}`);
  }
  return r.json() as Promise<OrcaProfileContent>;
}

export const saveOrcaProfileContent = (id: string, documents: OrcaProfileDocuments) =>
  putJson(`/catalog/profiles/${encodeURIComponent(id)}/content`, {
    format: "orca-json",
    documents,
  });

export const fetchJobHistory = (f?: typeof fetch) => getJson<JobHistoryEntry[]>("/jobs-history?limit=50", f);

/**
 * One settled job, or null when there is no such record. Deliberately NOT getJson():
 * that throws the same generic Error for every non-ok status, and the detail page has
 * to tell "no job with this id" (render a not-found page) apart from a genuine server
 * failure (surface the error). Only 404 becomes null; everything else still throws.
 */
export async function fetchJobHistoryEntry(
  id: string,
  fetchFn: typeof fetch = fetch,
): Promise<JobHistoryEntry | null> {
  const path = `/jobs-history/${encodeURIComponent(id)}`;
  const r = await fetchFn(path);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GET ${path} ${r.status}`);
  return r.json() as Promise<JobHistoryEntry>;
}

export const savePrinter = (p: Omit<CatalogPrinter, "hasSecrets"> & { secrets?: Record<string, string> }) =>
  putJson("/catalog/printers", p);
export const saveProfile = (p: CatalogProfile) => putJson("/catalog/profiles", p);

/**
 * DELETE that surfaces the server's message instead of flattening it to a status code,
 * so a refusal explains itself in the UI.
 */
async function del(path: string): Promise<void> {
  const r = await fetch(path, { method: "DELETE" });
  if (r.ok) return;
  let detail = "";
  try {
    const body = (await r.json()) as { error?: unknown };
    if (typeof body.error === "string") detail = body.error;
  } catch {
    /* non-JSON body — fall back to the status line */
  }
  throw new Error(detail || `DELETE ${path} ${r.status}`);
}

export const deletePrinter = (id: string) => del(`/catalog/printers/${encodeURIComponent(id)}`);
export const deleteProfile = (id: string) => del(`/catalog/profiles/${encodeURIComponent(id)}`);

export const resetOrcaProfileContent = (id: string) =>
  del(`/catalog/profiles/${encodeURIComponent(id)}/content`);
