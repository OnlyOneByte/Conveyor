import type {
  FormUiHints,
  JobState,
  JobStatusEvent,
  JobView,
  OrcaEditableProfile,
  OrcaProfileDocuments,
  PrusaProfileDocument,
  StageTiming,
} from "@conveyor/shared";
import type { AuthStatus } from "@conveyor/shared/auth-status";
import { failure, statusError } from "./http-error.js";

export const API = "/api";

export interface GeneratorSummary {
  id: string;
  name: string;
  paramSchema: Record<string, unknown>;
  ui?: FormUiHints;
  preview?: { kind: string; module: string };
  outputs: string[];
}

export async function fetchGenerators(fetchFn: typeof fetch = fetch): Promise<GeneratorSummary[]> {
  const r = await fetchFn(`${API}/generators`);
  if (!r.ok) throw statusError(r, "GET /generators");
  return r.json();
}

interface UploadResult {
  uploadId: string;
  filename: string;
  bytes: number;
}

export async function uploadStl(file: File): Promise<UploadResult> {
  const form = new FormData();
  form.append("file", file, file.name);
  const r = await fetch(`${API}/uploads`, { method: "POST", body: form });
  if (!r.ok) throw await failure(r, "POST /uploads");
  return r.json();
}

export async function submitJob(body: {
  generator: { id: string; params: unknown };
  printerId: string;
  profileId: string;
}): Promise<{ jobId: string }> {
  const r = await fetch(`${API}/jobs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw await failure(r, "POST /jobs");
  return r.json();
}

export function openJobSocket(jobId: string): WebSocket {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return new WebSocket(`${proto}://${location.host}${API}/jobs/${jobId}/ws`);
}

export async function fetchJobSnapshot(jobId: string): Promise<JobStatusEvent | null> {
  const r = await fetch(`${API}/jobs/${jobId}`);
  if (r.status === 404) return null;
  if (!r.ok) throw statusError(r, `GET /jobs/${jobId}`);
  return r.json();
}

export async function fetchActiveJobs(fetchFn: typeof fetch = fetch): Promise<JobView[]> {
  const r = await fetchFn(`${API}/jobs/active`);
  if (!r.ok) throw statusError(r, "GET /jobs/active");
  return r.json();
}

export async function cancelJob(jobId: string): Promise<void> {
  const r = await fetch(`${API}/jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST" });
  if (!r.ok) throw statusError(r, `POST /jobs/${jobId}/cancel`);
}

export interface PrinterReachable {
  reachable: boolean;
  latencyMs?: number;
  host: string;
  port: number;
  reason?: string;
}

export const fetchPrinterReachable = (id: string, f: typeof fetch = fetch) =>
  getJson<PrinterReachable>(`${API}/catalog/printers/${encodeURIComponent(id)}/reachable`, f);

export const signedIn = (status: AuthStatus | null): boolean =>
  status !== null && (!status.authEnabled || status.authenticated);

export async function logout(): Promise<void> {
  await fetch(`${API}/auth/logout`, { method: "POST" });
}

export interface CatalogPrinter {
  id: string;
  transportId: string;
  name: string;
  address: string;
  hasSecrets: boolean;
  allowedGenerators?: string[];
  lastSeenAt?: number;
  lastCheckedAt?: number;
  hold?: { jobId: string; reason: string; at: number };
}
type PrinterWrite = Omit<CatalogPrinter, "hasSecrets" | "lastSeenAt" | "lastCheckedAt" | "hold"> & {
  secrets?: Record<string, string> | null;
};
export interface CatalogProfile {
  id: string;
  slicerId: string;
  name: string;
  path: string;
  gcodeFlavor: string;
  hasEditableContent?: boolean;
  bundled?: boolean;
  volume?: { x: number; y: number; z: number };
}

export type CatalogSlicer = { id: string; name: string };

interface OrcaProfileContent extends OrcaEditableProfile {
  source: "bundled" | "edited";
}

interface PrusaProfileContent {
  format: "prusa-ini";
  source: "bundled" | "edited";
  document: PrusaProfileDocument;
}
export interface JobHistoryEntry {
  id: string;
  request: { generator: { id: string; params?: unknown }; printerId: string; profileId: string };
  state: JobState;
  stage?: string | null;
  error?: { stage: string; reason: string };
  artifacts?: { model?: string; gcode?: string };
  filesRemovedAfterDays?: number;
  timings?: StageTiming[];
  filament?: { grams?: number; metres?: number };
  notes?: string;
  createdAt: number;
  updatedAt: number;
}

async function getJson<T>(path: string, fetchFn: typeof fetch = fetch): Promise<T> {
  const r = await fetchFn(path);
  if (!r.ok) throw await failure(r, `GET ${path}`);
  return r.json();
}
async function putJson(path: string, body: unknown): Promise<void> {
  const r = await fetch(path, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw await failure(r, `PUT ${path}`);
}

export const fetchCatalogPrinters = (f?: typeof fetch) =>
  getJson<CatalogPrinter[]>(`${API}/catalog/printers`, f);
export interface CatalogTransport {
  id: string;
  name: string;
  acceptsFlavors: string[];
}

export const fetchCatalogTransports = (f?: typeof fetch) =>
  getJson<CatalogTransport[]>(`${API}/catalog/transports`, f);
export const fetchCatalogProfiles = (f?: typeof fetch) =>
  getJson<CatalogProfile[]>(`${API}/catalog/profiles`, f);
export const fetchCatalogSlicers = (f?: typeof fetch) =>
  getJson<CatalogSlicer[]>(`${API}/catalog/slicers`, f);

async function fetchProfileContent<T>(id: string, fetchFn: typeof fetch): Promise<T | null> {
  const path = `${API}/catalog/profiles/${encodeURIComponent(id)}/content`;
  const r = await fetchFn(path);
  if (r.status === 404) return null;
  if (!r.ok) throw await failure(r, `GET ${path}`);
  return r.json();
}

export const fetchOrcaProfileContent = (id: string, f: typeof fetch = fetch) =>
  fetchProfileContent<OrcaProfileContent>(id, f);

export const saveOrcaProfileContent = (id: string, documents: OrcaProfileDocuments) =>
  putJson(`${API}/catalog/profiles/${encodeURIComponent(id)}/content`, {
    format: "orca-json",
    documents,
  });

export const fetchPrusaProfileContent = (id: string, f: typeof fetch = fetch) =>
  fetchProfileContent<PrusaProfileContent>(id, f);

export const savePrusaProfileContent = (id: string, document: PrusaProfileDocument) =>
  putJson(`${API}/catalog/profiles/${encodeURIComponent(id)}/content`, {
    format: "prusa-ini",
    document,
  });

export const fetchJobHistory = (f?: typeof fetch) =>
  getJson<JobHistoryEntry[]>(`${API}/jobs-history?limit=200`, f);

export async function fetchJobHistoryEntry(
  id: string,
  fetchFn: typeof fetch = fetch,
): Promise<JobHistoryEntry | null> {
  const path = `${API}/jobs-history/${encodeURIComponent(id)}`;
  const r = await fetchFn(path);
  if (r.status === 404) return null;
  if (!r.ok) throw statusError(r, `GET ${path}`);
  return r.json() as Promise<JobHistoryEntry>;
}

export const savePrinter = (p: PrinterWrite) => putJson(`${API}/catalog/printers`, p);
export async function releasePrinterHold(id: string, fetchFn: typeof fetch = fetch): Promise<void> {
  const path = `${API}/catalog/printers/${encodeURIComponent(id)}/release`;
  const r = await fetchFn(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ confirm: true }),
  });
  if (!r.ok) throw await failure(r, `POST ${path}`);
}
export const saveProfile = (p: CatalogProfile) => putJson(`${API}/catalog/profiles`, p);
