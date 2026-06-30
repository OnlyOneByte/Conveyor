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

// ─── Auth ───────────────────────────────────────────────────────────────────
export type Role = "user" | "admin";

export interface AuthStatus {
  authEnabled: boolean;
  authenticated: boolean;
  role: Role | null;
}

export async function fetchAuthStatus(fetchFn: typeof fetch = fetch): Promise<AuthStatus> {
  const r = await fetchFn("/auth/status");
  if (!r.ok) throw new Error(`GET /auth/status ${r.status}`);
  return r.json();
}

export async function login(password: string): Promise<{ role: Role }> {
  const r = await fetch("/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? `login failed (${r.status})`);
  }
  return r.json();
}

export async function logout(): Promise<void> {
  await fetch("/auth/logout", { method: "POST" });
}

// ─── Admin ──────────────────────────────────────────────────────────────────
export interface AdminStation {
  id: string;
  name: string;
  transportId: string;
  printerId: string;
  slicerId: string;
  profileId: string;
  allowedGenerators?: string[];
}
export interface AdminPrinter {
  id: string;
  transportId: string;
  name: string;
  address: string;
  hasSecrets: boolean;
}
export interface AdminProfile {
  id: string;
  slicerId: string;
  name: string;
  path: string;
  gcodeFlavor: string;
}
export interface JobHistoryEntry {
  id: string;
  request: { generator: { id: string; params?: unknown }; stationId: string };
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

export const fetchAdminStations = (f?: typeof fetch) => getJson<AdminStation[]>("/admin/stations", f);
export const fetchAdminPrinters = (f?: typeof fetch) => getJson<AdminPrinter[]>("/admin/printers", f);
export const fetchAdminProfiles = (f?: typeof fetch) => getJson<AdminProfile[]>("/admin/profiles", f);
export const fetchJobHistory = (f?: typeof fetch) => getJson<JobHistoryEntry[]>("/jobs-history?limit=50", f);

export const saveStation = (s: AdminStation) => putJson("/admin/stations", s);
export const savePrinter = (p: Omit<AdminPrinter, "hasSecrets"> & { secrets?: Record<string, string> }) =>
  putJson("/admin/printers", p);
export const saveProfile = (p: AdminProfile) => putJson("/admin/profiles", p);

export async function deleteStation(id: string): Promise<void> {
  const r = await fetch(`/admin/stations/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!r.ok) throw new Error(`DELETE /admin/stations/${id} ${r.status}`);
}
