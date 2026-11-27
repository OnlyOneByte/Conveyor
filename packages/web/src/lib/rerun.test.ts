import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { Held } from "./http-error";
import {
  ALREADY_RETRIED,
  AlreadyRetried,
  linkedRetry,
  rerunOnMake,
  rerunRequest,
  sendJob,
  stashRerun,
  takeRerun,
} from "./rerun";

const request = {
  generator: { id: "gridfinity", params: { gridX: 2 } },
  printerId: "voron",
  profileId: "pla",
};

describe("whether a job can run again", () => {
  test("a done or canceled job runs again with its own request", () => {
    expect([
      rerunRequest({ state: "done", request }),
      rerunRequest({ state: "canceled", request }),
    ]).toEqual([request, request]);
  });

  test("a failure, a job still running, an upload, or a job missing its printer or profile can't", () => {
    const upload = { ...request, generator: { id: "passthrough", params: { uploadId: "u1" } } };
    expect([
      rerunRequest({ state: "failed", request }),
      rerunRequest({ state: "printing", request }),
      rerunRequest({ state: "done", request: upload }),
      rerunRequest({ state: "done", request: { ...request, printerId: "" } }),
      rerunRequest({ state: "canceled", request: { ...request, profileId: "" } }),
    ]).toEqual([null, null, null, null, null]);
  });

  test("Make keeps a failure's retryOf only while it generates with the stashed generator", () => {
    const handoff = { generatorId: "gridfinity", printerId: "", profileId: "", retryOf: "f1" };
    expect([
      linkedRetry(handoff, "generate", "gridfinity"),
      linkedRetry(handoff, "upload", "gridfinity"),
      linkedRetry(handoff, "generate", "baseplate"),
      linkedRetry({ ...handoff, retryOf: undefined }, "generate", "gridfinity"),
      linkedRetry(null, "generate", "gridfinity"),
    ]).toEqual(["f1", undefined, undefined, undefined, undefined]);
  });

  test("Make sends a retry through retryJob; a 409 reads in plain words, other refusals pass through", async () => {
    const sent: string[] = [];
    const replying = (status: number, body: object) =>
      Object.assign(
        async (_: string | URL | Request, init?: RequestInit) => {
          sent.push(String(init?.body));
          return Response.json(body, { status });
        },
        { preconnect: fetch.preconnect },
      );
    expect(await sendJob(request, "f1", replying(202, { jobId: "j2" }))).toEqual({ jobId: "j2" });
    expect(sent).toEqual([JSON.stringify({ ...request, retryOf: "f1" })]);
    await expect(
      sendJob(request, "f1", replying(409, { error: "retryOf: job f1 was already retried" })),
    ).rejects.toThrow(ALREADY_RETRIED);
    await expect(
      sendJob(request, "f1", replying(400, { error: "unknown printer voron" })),
    ).rejects.toThrow("unknown printer voron");
    expect(ALREADY_RETRIED).toBe("This job was already retried.");
    const taken = { error: "retryOf: job f1 was already retried", retriedBy: "r1" };
    const refused = await sendJob(request, "f1", replying(409, taken)).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(AlreadyRetried);
    expect(refused).toMatchObject({ message: ALREADY_RETRIED, retriedBy: "r1" });
    const unnamed = await sendJob(request, "f1", replying(409, { error: "taken" })).catch(
      (e: unknown) => e,
    );
    expect(unnamed).toMatchObject({ message: ALREADY_RETRIED, retriedBy: null });
  });

  test("a job that isn't a retry goes to POST /jobs as a fresh submission", async () => {
    const posted: unknown[] = [];
    const fake = async (_: string | URL | Request, init?: RequestInit) => {
      posted.push(JSON.parse(String(init?.body)));
      return Response.json({ jobId: "j9" }, { status: 202 });
    };
    const spy = spyOn(globalThis, "fetch").mockImplementation(
      Object.assign(fake, { preconnect: fetch.preconnect }),
    );
    try {
      expect(await sendJob(request)).toEqual({ jobId: "j9" });
      expect(posted).toEqual([request]);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("handing a job back to Make", () => {
  const store = new Map<string, string>();
  const session = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  };
  const assigned: string[] = [];

  beforeEach(() => {
    store.clear();
    assigned.length = 0;
    Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: session });
    Object.defineProperty(globalThis, "location", {
      configurable: true,
      value: { assign: (url: string) => assigned.push(url) },
    });
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, "sessionStorage");
    Reflect.deleteProperty(globalThis, "location");
  });

  test("rerunOnMake stashes the request with its retryOf and opens Make", () => {
    rerunOnMake(request, "f1");
    expect(assigned).toEqual(["/?rerun=1"]);
    expect(takeRerun()).toEqual({
      generatorId: "gridfinity",
      params: { gridX: 2 },
      printerId: "voron",
      profileId: "pla",
      retryOf: "f1",
    });
  });

  test("a stashed rerun is taken once", () => {
    stashRerun({ generatorId: "gridfinity", printerId: "voron", profileId: "pla" });
    expect(takeRerun()?.generatorId).toBe("gridfinity");
    expect(takeRerun()).toBeNull();
  });

  test("nothing stashed, unreadable JSON or a storage that throws reads as no rerun", () => {
    expect(takeRerun()).toBeNull();
    store.set("conveyor.rerun", "{not json");
    expect(takeRerun()).toBeNull();
    const refusing = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {},
    };
    Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: refusing });
    expect(() =>
      stashRerun({ generatorId: "gridfinity", printerId: "voron", profileId: "pla" }),
    ).not.toThrow();
    expect(takeRerun()).toBeNull();
  });
});

test("a retry from Make to a held printer throws the hold, not AlreadyRetried", async () => {
  const hold = "Voron is on hold. Check it, then choose Release hold on the Printers page.";
  const replying = (status: number, body: unknown) =>
    Object.assign(async () => Response.json(body, { status }), { preconnect: fetch.preconnect });
  const request = {
    generator: { id: "gridfinity", params: {} },
    printerId: "voron",
    profileId: "p",
  };
  const refused = await sendJob(request, "f1", replying(409, { error: hold, held: true })).catch(
    (e: unknown) => e,
  );
  expect(refused).toBeInstanceOf(Held);
  expect(refused).not.toBeInstanceOf(AlreadyRetried);
});
