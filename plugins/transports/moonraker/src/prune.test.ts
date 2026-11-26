import { afterAll, expect, spyOn, test } from "bun:test";
import { moonraker } from "./index";

const BASE = "http://192.0.2.9:7125";
const target = { id: "p", transportId: "moonraker", address: "192.0.2.9:7125", secrets: {} };
const { preconnect } = globalThis.fetch;
const fetchSpy = spyOn(globalThis, "fetch");
afterAll(() => fetchSpy.mockRestore());

const LISTED = [
  "conveyor-a1.gcode",
  "conveyor-b2.gcode",
  "conveyor-c3.gcode",
  "benchy.gcode",
  "conveyor-a1.gcode.bak",
  "old/conveyor-d4.gcode",
];

function printer(stats: unknown, deleteStatus = 200) {
  const deleted: string[] = [];
  const answer = async (url: string | URL | Request, init?: RequestInit) => {
    const at = String(url);
    if (at === `${BASE}/printer/objects/query?print_stats`)
      return Response.json({ result: { status: { print_stats: stats } } });
    if (at === `${BASE}/server/files/list?root=gcodes`)
      return Response.json({ result: LISTED.map((path) => ({ path, modified: 1, size: 9 })) });
    if (init?.method === "DELETE" && at.startsWith(`${BASE}/server/files/gcodes/`)) {
      deleted.push(decodeURIComponent(at.slice(`${BASE}/server/files/gcodes/`.length)));
      return new Response("{}", { status: deleteStatus });
    }
    return new Response("unexpected", { status: 500 });
  };
  fetchSpy.mockImplementation(Object.assign(answer, { preconnect }));
  return deleted;
}

const prune = (keep: string[]) =>
  moonraker.pruneFiles?.(target, new Set(keep), new AbortController().signal);

test("deletes Conveyor's old files, sparing the kept one and the one printing", async () => {
  const deleted = printer({ state: "printing", filename: "conveyor-b2.gcode" });
  expect(await prune(["conveyor-c3.gcode"])).toEqual(["conveyor-a1.gcode"]);
  expect(deleted).toEqual(["conveyor-a1.gcode"]);
});

test("never deletes a file Conveyor didn't name, or one outside the top folder", async () => {
  const deleted = printer({ state: "standby", filename: "" });
  await prune([]);
  expect(deleted).toEqual(["conveyor-a1.gcode", "conveyor-b2.gcode", "conveyor-c3.gcode"]);
});

test("spares the file a finished print left loaded", async () => {
  const deleted = printer({ state: "complete", filename: "conveyor-a1.gcode" });
  await prune([]);
  expect(deleted).toEqual(["conveyor-b2.gcode", "conveyor-c3.gcode"]);
});

test("deletes nothing when the printer is busy but names no file", async () => {
  const deleted = printer({ state: "printing" });
  await expect(prune([])).rejects.toThrow("moonraker is printing but names no file");
  expect(deleted).toEqual([]);
});

test("deletes nothing when the printer state can't be read", async () => {
  const deleted = printer({});
  await expect(prune([])).rejects.toThrow("moonraker gave no printer state");
  expect(deleted).toEqual([]);
});

test("a refused delete is reported", async () => {
  printer({ state: "standby" }, 403);
  await expect(prune(["conveyor-b2.gcode", "conveyor-c3.gcode"])).rejects.toThrow(
    "moonraker could not delete conveyor-a1.gcode: 403; removed none",
  );
});
