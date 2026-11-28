import { afterAll, describe, expect, spyOn, test } from "bun:test";
import { API } from "./api";
import { deletePrinter, deleteProfile, resetProfileContent } from "./api-delete";

const { preconnect } = globalThis.fetch;
const fetchSpy = spyOn(globalThis, "fetch");
afterAll(() => fetchSpy.mockRestore());

function answering(status: number, body?: unknown) {
  const calls: { url: string; method?: string }[] = [];
  const impl = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method });
    return body === undefined ? new Response(null, { status }) : Response.json(body, { status });
  };
  fetchSpy.mockImplementation(Object.assign(impl, { preconnect }));
  return calls;
}

describe("the delete calls", () => {
  test("send DELETE to the printer, the profile and the profile's content, encoding the id", async () => {
    const calls = answering(204);
    await deletePrinter("klipper garage");
    await deleteProfile("orca/klipper-pla-0.2");
    await resetProfileContent("orca/klipper-pla-0.2");
    expect(calls).toEqual([
      { url: `${API}/catalog/printers/klipper%20garage`, method: "DELETE" },
      { url: `${API}/catalog/profiles/orca%2Fklipper-pla-0.2`, method: "DELETE" },
      { url: `${API}/catalog/profiles/orca%2Fklipper-pla-0.2/content`, method: "DELETE" },
    ]);
  });

  test("a refused delete throws with the server's reason", async () => {
    answering(409, { error: "the printer has jobs in flight" });
    await expect(deletePrinter("p1")).rejects.toThrow("the printer has jobs in flight");
  });
});
