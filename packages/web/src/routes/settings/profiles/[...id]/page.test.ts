import { describe, expect, test } from "bun:test";
import { shown } from "#lib/http-error.js";
import { NOT_LOADED } from "#lib/said.js";
import { load } from "./+page";

const answering = (status: number, body: unknown): typeof fetch =>
  Object.assign(async () => Response.json(body, { status }), { preconnect: () => {} });

const run = (fetchFn: typeof fetch): Promise<unknown> =>
  Reflect.apply(load, undefined, [
    {
      params: { id: "orca/klipper-pla-0.2" },
      fetch: fetchFn,
      parent: async () => ({ auth: { authEnabled: false, authenticated: false } }),
    },
  ]);

describe("a profile that fails to load", () => {
  test("leads with a plain sentence and keeps the server's own reason for Details", async () => {
    const reason = "databaseislocked".repeat(40);
    expect(await run(answering(500, { error: reason }))).toMatchObject({
      failed: false,
      problem: NOT_LOADED,
      detail: shown(reason),
    });
  });

  test("a bare status keeps the status line as the detail", async () => {
    expect(await run(answering(500, {}))).toMatchObject({
      problem: NOT_LOADED,
      detail: "GET /api/catalog/profiles 500",
    });
  });

  test("an unreachable Conveyor is the can't-reach state, with no detail", async () => {
    const offline = Object.assign(
      async () => {
        throw new TypeError("fetch failed");
      },
      { preconnect: () => {} },
    );
    expect(await run(offline)).toMatchObject({ failed: true, problem: "", detail: null });
  });
});

const routed = (routes: Record<string, unknown>): typeof fetch =>
  Object.assign(
    async (input: RequestInfo | URL) => {
      const path = new URL(String(input), "http://conveyor.test").pathname;
      return path in routes ? Response.json(routes[path]) : new Response(null, { status: 404 });
    },
    { preconnect: () => {} },
  );

const prusa = {
  id: "prusa/klipper-pla-0.2",
  slicerId: "prusa",
  name: "Prusa PLA",
  path: "/profiles/prusa-klipper-pla-0.2",
  gcodeFlavor: "klipper",
};

const runAs = (
  id: string,
  auth: { authEnabled: boolean; authenticated: boolean },
  f: typeof fetch,
) => Reflect.apply(load, undefined, [{ params: { id }, fetch: f, parent: async () => ({ auth }) }]);

describe("a profile that loads", () => {
  const open = { authEnabled: false, authenticated: false };
  const api = routed({
    "/api/catalog/profiles": [prusa],
    "/api/catalog/slicers": [{ id: "prusa", name: "PrusaSlicer" }],
    "/api/catalog/profiles/prusa%2Fklipper-pla-0.2/content": {
      source: "edited",
      document: { config: "layer_height = 0.2\n" },
    },
  });

  test("returns the profile, the slicers and its saved content", async () => {
    expect(await runAs(prusa.id, open, api)).toEqual({
      profile: prusa,
      slicers: [{ id: "prusa", name: "PrusaSlicer" }],
      content: {
        files: ["config"],
        lang: "ini",
        docs: { config: "layer_height = 0.2\n" },
        edited: true,
        missing: false,
      },
      failed: false,
      problem: "",
      detail: null,
    });
  });

  test("an id the catalog doesn't have loads no profile and no content", async () => {
    expect(await runAs("nope", open, api)).toMatchObject({ profile: null, content: null });
  });

  test("loads nothing for a signed-out visitor when auth is on", async () => {
    const out = { authEnabled: true, authenticated: false };
    expect(await runAs(prusa.id, out, api)).toEqual({
      profile: null,
      content: null,
      slicers: [],
      failed: false,
      problem: "",
      detail: null,
    });
  });
});
