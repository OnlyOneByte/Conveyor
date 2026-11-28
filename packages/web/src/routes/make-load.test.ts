import { describe, expect, test } from "bun:test";
import { EMPTY_CATALOG } from "#lib/make.js";
import { load } from "./+page";

const OPEN = { authEnabled: false, authenticated: false };
const LOCKED = { authEnabled: true, authenticated: false };

const answering = (byPath: Record<string, unknown>, down: string[] = []): typeof fetch =>
  Object.assign(
    async (input: RequestInfo | URL) => {
      const path = new URL(String(input), "http://conveyor.test").pathname;
      if (down.includes(path)) return Response.json({}, { status: 503 });
      return Response.json(byPath[path] ?? []);
    },
    { preconnect: () => {} },
  );

const run = (auth: typeof OPEN, fetchFn: typeof fetch, search = "") =>
  Reflect.apply(load, undefined, [
    {
      url: new URL(`http://conveyor.test/${search}`),
      fetch: fetchFn,
      parent: async () => ({ auth }),
    },
  ]);

describe("Make's load", () => {
  test("signed in, the catalog arrives together with the form's pieces", async () => {
    const printer = { id: "mk4", transportId: "moonraker", name: "MK4", address: "10.0.0.9" };
    const data = await run(OPEN, answering({ "/api/catalog/printers": [printer] }));
    const catalog = await data.catalog;
    expect(catalog.printers).toEqual([printer]);
    expect(catalog.printersFailed).toBe(false);
    expect(Object.keys(catalog.parts ?? {}).sort()).toEqual([
      "MakeWhere",
      "PrintDock",
      "SchemaForm",
      "UploadDrop",
    ]);
  });

  test("printers that don't answer are marked down, and the rest still loads", async () => {
    const data = await run(OPEN, answering({}, ["/api/catalog/printers"]));
    const catalog = await data.catalog;
    expect(catalog.printersFailed).toBe(true);
    expect(catalog.printers).toEqual([]);
    expect(catalog.parts).not.toBeNull();
  });

  test("signed out, Make asks for nothing and still brings the form's pieces", async () => {
    let asked = 0;
    const counting = Object.assign(
      async () => {
        asked += 1;
        return Response.json([]);
      },
      { preconnect: () => {} },
    );
    const catalog = await (await run(LOCKED, counting)).catalog;
    expect(asked).toBe(0);
    expect(catalog).toMatchObject(EMPTY_CATALOG);
    expect(catalog.parts).not.toBeNull();
  });

  test("a job link goes to the job when Make isn't on screen", async () => {
    const redirected = await run(OPEN, answering({}), "?job=seed%20printed").catch(
      (e: unknown) => e,
    );
    expect(redirected).toMatchObject({ status: 307, location: "/jobs/seed%20printed" });
  });
});
