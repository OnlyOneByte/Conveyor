import { describe, expect, spyOn, test } from "bun:test";
import { CATALOG_MS, loadCatalog } from "./catalog";

const printer = {
  id: "voron",
  name: "Voron 2.4",
  transportId: "klipper",
  address: "192.0.2.9",
  hasSecrets: false,
};
const reply = (ok: boolean) => async (url: string | URL | Request) =>
  ok
    ? Response.json(String(url).endsWith("/printers") ? [printer] : [])
    : new Response("", { status: 401 });
const answers = (ok: boolean) =>
  spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(reply(ok), { preconnect: fetch.preconnect }),
  );

describe("the shared catalog", () => {
  test("fetches printers and generators once per minute, and again after a failure", async () => {
    const t = 1e12;
    const down = answers(false);
    await expect(loadCatalog(t)).rejects.toThrow("401");
    down.mockRestore();
    const fetched = answers(true);
    expect((await loadCatalog(t + 1)).printers).toEqual([printer]);
    await loadCatalog(t + CATALOG_MS - 1);
    expect(fetched).toHaveBeenCalledTimes(2);
    await loadCatalog(t + CATALOG_MS + 1);
    expect([CATALOG_MS, fetched.mock.calls.length]).toEqual([60000, 4]);
    await loadCatalog(t + 2);
    expect(fetched).toHaveBeenCalledTimes(6);
    fetched.mockRestore();
  });
});
