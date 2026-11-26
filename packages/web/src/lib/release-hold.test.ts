import { expect, test } from "bun:test";
import { releasePrinterHold } from "./api";

test("releasing a hold confirms it to the printer's release route", async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const answer = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return Response.json({ ok: true, printerId: "p 1" });
  };
  await releasePrinterHold("p 1", Object.assign(answer, { preconnect: fetch.preconnect }));
  expect(calls.map((call) => [call.url, call.init?.method, call.init?.body])).toEqual([
    ["/api/catalog/printers/p%201/release", "POST", JSON.stringify({ confirm: true })],
  ]);
});

test("a refused release throws the server's reason", async () => {
  const answer = async () => Response.json({ error: "printer p1 has no hold" }, { status: 409 });
  await expect(
    releasePrinterHold("p1", Object.assign(answer, { preconnect: fetch.preconnect })),
  ).rejects.toThrow("printer p1 has no hold");
});
