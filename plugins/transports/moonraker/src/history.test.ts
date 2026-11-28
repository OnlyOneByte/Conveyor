import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { PrintStatus } from "@conveyor/shared";
import { stubPrinterDns } from "../../../../packages/shared/test/helpers/index.ts";
import { moonraker as plugin } from "./index.ts";
import { STANDBY_ENDED } from "./watch.ts";

const cleanups: (() => void)[] = [];
beforeEach(() => {
  const before = process.env.MOONRAKER_POLL_MS;
  process.env.MOONRAKER_POLL_MS = "1";
  cleanups.push(() => {
    if (before === undefined) delete process.env.MOONRAKER_POLL_MS;
    else process.env.MOONRAKER_POLL_MS = before;
  });
});
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

type Job = { filename: string; status: string };
type History = Job[] | number | "garbage" | (() => Job[]);

const stats = (state?: string, progress = 0.4) => ({
  print_stats: state === undefined ? {} : { state },
  virtual_sdcard: { progress },
});
const ENDS_IN_STANDBY = [stats("printing"), stats("standby"), stats("standby"), stats("standby")];

function printer(polls: Record<string, unknown>[], history: History) {
  const asked: string[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/server/history/list") {
        asked.push(url.search);
        if (typeof history === "number") return new Response("no", { status: history });
        if (history === "garbage") return Response.json({ result: { jobs: "none" } });
        const jobs = typeof history === "function" ? history() : history;
        return Response.json({ result: { count: jobs.length, jobs } });
      }
      const poll = polls.length > 1 ? polls.shift() : polls[0];
      return Response.json({ result: { status: poll } });
    },
  });
  cleanups.push(() => server.stop(true));
  const handle = {
    transportId: "moonraker",
    printerId: "p1",
    ref: "conveyor-j1.gcode",
    address: `127.0.0.1:${server.port}`,
  };
  return { asked, handle };
}

async function ending(polls: Record<string, unknown>[], history: History) {
  const { asked, handle } = printer([...polls], history);
  const out: PrintStatus[] = [];
  for await (const s of plugin.status(handle)) out.push(s);
  return { last: out.at(-1), asked };
}

const job = (status: string, filename = "conveyor-j1.gcode") => ({ filename, status });

describe("a print that ends in standby before reporting how it ended", () => {
  test("is done when the job history says completed", async () => {
    const { last, asked } = await ending(ENDS_IN_STANDBY, [job("completed")]);
    expect(last).toEqual({ state: "done", progress: 1 });
    expect(asked).toEqual(["?limit=20&order=desc"]);
  });

  test("is canceled when the job history says cancelled", async () => {
    const { last } = await ending(ENDS_IN_STANDBY, [
      job("completed", "other.gcode"),
      job("cancelled"),
    ]);
    expect(last).toEqual({ state: "canceled", message: "print cancelled on printer" });
  });

  test("fails naming the status when the job history records an error", async () => {
    const { last } = await ending(ENDS_IN_STANDBY, [job("klippy_shutdown")]);
    expect(last).toEqual({ state: "failed", message: "the job history says klippy_shutdown" });
  });

  test("keeps watching while the history says in progress, and uses the end it records next", async () => {
    let checks = 0;
    const { last, asked } = await ending(ENDS_IN_STANDBY, () =>
      ++checks < 2 ? [job("in_progress")] : [job("completed")],
    );
    expect(last).toEqual({ state: "done", progress: 1 });
    expect(asked).toHaveLength(2);
  });

  test("fails after three checks that all say in progress", async () => {
    const { last, asked } = await ending(ENDS_IN_STANDBY, [job("in_progress")]);
    expect(last).toEqual({
      state: "failed",
      message: `${STANDBY_ENDED} (job history: the job is still in progress)`,
    });
    expect(asked).toHaveLength(3);
  });

  test.each<[string, History, string]>([
    [
      "has no entry for the file",
      [job("completed", "other.gcode")],
      "no history entry for conveyor-j1.gcode",
    ],
    ["answers 404", 404, "the history request failed: 404"],
    ["answers 500", 500, "the history request failed: 500"],
    ["answers something unreadable", "garbage", "the history reply couldn't be read"],
  ])("fails as before, saying why, when the history %s", async (_case, history, why) => {
    const { last } = await ending(ENDS_IN_STANDBY, history);
    expect(last).toEqual({ state: "failed", message: `${STANDBY_ENDED} (job history: ${why})` });
  });
});

test("a reply without print_stats.state is unknown, so it doesn't count toward standby", async () => {
  const polls = [
    stats("printing"),
    stats("standby"),
    stats("standby"),
    stats(undefined),
    stats("standby"),
    stats("standby"),
    stats("complete"),
  ];
  const { last, asked } = await ending(polls, [job("error")]);
  expect(last).toEqual({ state: "done", progress: 1 });
  expect(asked).toEqual([]);
});

test("the history request goes to the IP the guard checked, with the name in Host", async () => {
  const dns = stubPrinterDns(["192.168.1.40"]);
  cleanups.push(dns.restore);
  const { preconnect } = globalThis.fetch;
  const seen: { url: string; host: string | null }[] = [];
  const polls = [...ENDS_IN_STANDBY];
  const spy = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        seen.push({ url, host: new Headers(init?.headers).get("host") });
        if (url.includes("/server/history/list"))
          return Response.json({ result: { jobs: [job("completed")] } });
        const poll = polls.length > 1 ? polls.shift() : polls[0];
        return Response.json({ result: { status: poll } });
      },
      { preconnect },
    ),
  );
  cleanups.push(() => spy.mockRestore());
  const handle = {
    transportId: "moonraker",
    printerId: "p1",
    ref: "conveyor-j1.gcode",
    address: "printer.example:7125",
  };
  const out: PrintStatus[] = [];
  for await (const s of plugin.status(handle)) out.push(s);
  expect(out.at(-1)).toEqual({ state: "done", progress: 1 });
  expect(seen.filter((r) => r.url.includes("/server/history/list"))).toEqual([
    {
      url: "http://192.168.1.40:7125/server/history/list?limit=20&order=desc",
      host: "printer.example:7125",
    },
  ]);
});
