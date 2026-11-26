import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import {
  cancelJob,
  fetchActiveJobs,
  fetchCatalogPrinters,
  fetchCatalogProfiles,
  fetchCatalogSlicers,
  fetchCatalogTransports,
  fetchGenerators,
  fetchJobHistory,
  fetchJobHistoryEntry,
  fetchJobSnapshot,
  fetchOrcaProfileContent,
  fetchPrinterReachable,
  fetchPrusaProfileContent,
  logout,
  openJobSocket,
  saveOrcaProfileContent,
  savePrinter,
  saveProfile,
  savePrusaProfileContent,
  signedIn,
  submitJob,
  uploadStl,
} from "./api";
import { fetchAuthStatus } from "./auth-gate";
import { Unreachable } from "./http-error";

interface Sent {
  path: string;
  method: string;
  body: unknown;
}

let sent: Sent[];
let reply: () => Response;
let fetchSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  sent = [];
  reply = () => Response.json({ ok: true });
  const fake = async (input: string | URL | Request, init?: RequestInit) => {
    const body = init?.body;
    sent.push({
      path: String(input),
      method: init?.method ?? "GET",
      body: typeof body === "string" ? JSON.parse(body) : body,
    });
    return reply();
  };
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(fake, { preconnect: fetch.preconnect }),
  );
});

afterEach(() => fetchSpy.mockRestore());

const status =
  (code: number, body: object = {}) =>
  () =>
    Response.json(body, { status: code });

describe("reads", () => {
  test("each catalog read asks its own path", async () => {
    await fetchGenerators();
    await fetchCatalogPrinters();
    await fetchCatalogTransports();
    await fetchCatalogProfiles();
    await fetchCatalogSlicers();
    await fetchActiveJobs();
    await fetchAuthStatus().catch(() => undefined);
    await fetchJobHistory();
    await fetchPrinterReachable("voron 2");
    expect(sent.map((s) => s.path)).toEqual([
      "/api/generators",
      "/api/catalog/printers",
      "/api/catalog/transports",
      "/api/catalog/profiles",
      "/api/catalog/slicers",
      "/api/jobs/active",
      "/api/auth/status",
      "/api/jobs-history?limit=200",
      "/api/catalog/printers/voron%202/reachable",
    ]);
  });

  test("a gateway status reads as Unreachable and any other refusal as a plain error", async () => {
    reply = status(503);
    await expect(fetchGenerators()).rejects.toBeInstanceOf(Unreachable);
    await expect(fetchActiveJobs()).rejects.toBeInstanceOf(Unreachable);
    reply = status(500);
    const failed = await fetchAuthStatus().catch((e: unknown) => e);
    expect(failed).not.toBeInstanceOf(Unreachable);
    expect(failed).toMatchObject({ message: "GET /auth/status 500" });
  });

  test("a refused catalog read carries the server's error message", async () => {
    reply = status(400, { error: "bad filter" });
    await expect(fetchCatalogProfiles()).rejects.toThrow("bad filter");
  });

  test("a missing job, history entry or profile content reads as null", async () => {
    reply = status(404);
    expect(await fetchJobSnapshot("j1")).toBeNull();
    expect(await fetchJobHistoryEntry("j/1")).toBeNull();
    expect(await fetchOrcaProfileContent("orca/pla")).toBeNull();
    expect(await fetchPrusaProfileContent("prusa/pla")).toBeNull();
    expect(sent.map((s) => s.path)).toEqual([
      "/api/jobs/j1",
      "/api/jobs-history/j%2F1",
      "/api/catalog/profiles/orca%2Fpla/content",
      "/api/catalog/profiles/prusa%2Fpla/content",
    ]);
  });

  test("other refusals of those reads throw", async () => {
    reply = status(500, { error: "disk full" });
    await expect(fetchJobSnapshot("j1")).rejects.toThrow("GET /jobs/j1 500");
    await expect(fetchJobHistoryEntry("j1")).rejects.toThrow("GET /api/jobs-history/j1 500");
    await expect(fetchOrcaProfileContent("p")).rejects.toThrow("disk full");
  });

  test("a found job and history entry come back as sent", async () => {
    const snapshot = { jobId: "j1", state: "done" as const, at: 1 };
    reply = () => Response.json(snapshot);
    expect(await fetchJobSnapshot("j1")).toEqual(snapshot);
    reply = () => Response.json({ id: "j1", state: "done" });
    expect(await fetchJobHistoryEntry("j1")).toMatchObject({ id: "j1" });
  });
});

describe("writes", () => {
  const job = {
    generator: { id: "gridfinity", params: { gridX: 2 } },
    printerId: "voron",
    profileId: "pla",
  };

  test("submitJob posts the request and returns the job id", async () => {
    reply = () => Response.json({ jobId: "j1" }, { status: 202 });
    expect(await submitJob(job)).toEqual({ jobId: "j1" });
    expect(sent).toEqual([{ path: "/api/jobs", method: "POST", body: job }]);
  });

  test("a refused submission throws the server's reason", async () => {
    reply = status(400, { error: "unknown printer voron" });
    await expect(submitJob(job)).rejects.toThrow("unknown printer voron");
  });

  test("uploadStl posts the file as form data under its own name", async () => {
    reply = () => Response.json({ uploadId: "u1", filename: "clip.stl", bytes: 4 });
    const file = new File(["solid"], "clip.stl");
    expect(await uploadStl(file)).toEqual({ uploadId: "u1", filename: "clip.stl", bytes: 4 });
    expect(sent[0]?.path).toBe("/api/uploads");
    const form = sent[0]?.body;
    if (!(form instanceof FormData)) throw new Error("uploadStl sent no form data");
    expect(form.get("file")).toMatchObject({ name: "clip.stl" });
    reply = status(413, { error: "file too large" });
    await expect(uploadStl(file)).rejects.toThrow("file too large");
  });

  test("cancelJob posts to the job's cancel path and throws on a refusal", async () => {
    await cancelJob("j 1");
    expect(sent).toEqual([{ path: "/api/jobs/j%201/cancel", method: "POST", body: undefined }]);
    reply = status(409);
    await expect(cancelJob("j1")).rejects.toThrow("POST /jobs/j1/cancel 409");
  });

  test("saves PUT the printer, the profile and each profile format", async () => {
    const printer = { id: "voron", transportId: "klipper", name: "Voron", address: "192.0.2.9" };
    const profile = { id: "pla", slicerId: "orca", name: "PLA", path: "p", gcodeFlavor: "klipper" };
    await savePrinter(printer);
    await saveProfile(profile);
    const documents = { machine: "{}", process: '{"name":"x"}', filament: "{}" };
    await saveOrcaProfileContent("orca/pla", documents);
    await savePrusaProfileContent("prusa/pla", { config: "layer_height = 0.2\n" });
    expect(sent.map(({ path, method }) => `${method} ${path}`)).toEqual([
      "PUT /api/catalog/printers",
      "PUT /api/catalog/profiles",
      "PUT /api/catalog/profiles/orca%2Fpla/content",
      "PUT /api/catalog/profiles/prusa%2Fpla/content",
    ]);
    expect(sent[0]?.body).toEqual(printer);
    expect(sent[2]?.body).toEqual({ format: "orca-json", documents });
    expect(sent[3]?.body).toEqual({
      format: "prusa-ini",
      document: { config: "layer_height = 0.2\n" },
    });
  });

  test("a refused save throws the server's reason", async () => {
    reply = status(422, { error: "address is not valid" });
    await expect(
      savePrinter({ id: "v", transportId: "k", name: "V", address: "?" }),
    ).rejects.toThrow("address is not valid");
  });

  test("logout posts to the logout path", async () => {
    await logout();
    expect(sent).toEqual([{ path: "/api/auth/logout", method: "POST", body: undefined }]);
  });
});

describe("signedIn", () => {
  test("is true with auth off, or with auth on and a session", () => {
    expect(signedIn({ authEnabled: false, authenticated: false })).toBe(true);
    expect(signedIn({ authEnabled: true, authenticated: true })).toBe(true);
    expect(signedIn({ authEnabled: true, authenticated: false })).toBe(false);
  });
});

describe("openJobSocket", () => {
  const opened: string[] = [];
  const RealSocket = globalThis.WebSocket;

  const socket = (value: unknown) =>
    Object.defineProperty(globalThis, "WebSocket", { configurable: true, writable: true, value });

  beforeEach(() => {
    opened.length = 0;
    socket(
      class {
        constructor(url: string) {
          opened.push(url);
        }
      },
    );
  });

  afterEach(() => {
    socket(RealSocket);
    Reflect.deleteProperty(globalThis, "location");
  });

  test("opens wss on an https page and ws on an http one, at the job's socket path", () => {
    for (const protocol of ["https:", "http:"]) {
      Object.defineProperty(globalThis, "location", {
        configurable: true,
        value: { protocol, host: "conveyor.home.arpa" },
      });
      openJobSocket("j1");
    }
    expect(opened).toEqual([
      "wss://conveyor.home.arpa/api/jobs/j1/ws",
      "ws://conveyor.home.arpa/api/jobs/j1/ws",
    ]);
  });
});
