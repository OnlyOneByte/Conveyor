import { afterEach, describe, expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PrintStatus, StageCtx } from "@conveyor/shared";
import { tempDirs } from "../../../../packages/shared/test/helpers/index.ts";
import { moonraker } from "./index.ts";

const tempDir = tempDirs("conveyor-redirect-");

const stops: (() => void)[] = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
});

function servers(redirectPaths: string[]) {
  let followed = 0;
  const target = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      followed++;
      return Response.json({ result: { status: { print_stats: { state: "complete" } } } });
    },
  });
  const printer = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      await req.arrayBuffer();
      const path = new URL(req.url).pathname;
      if (redirectPaths.some((p) => path.endsWith(p)))
        return Response.redirect(`http://127.0.0.1:${target.port}/elsewhere`, 302);
      return Response.json({ result: "ok" });
    },
  });
  stops.push(
    () => printer.stop(true),
    () => target.stop(true),
  );
  return { address: `127.0.0.1:${printer.port}`, followed: () => followed };
}

async function gcode(): Promise<{ path: string; ctx: StageCtx }> {
  const dir = await tempDir();
  const path = join(dir, "a.gcode");
  await writeFile(path, "G28\n");
  const ctx: StageCtx = {
    jobId: "j",
    workDir: dir,
    signal: new AbortController().signal,
    report: () => {},
    log: () => {},
  };
  return { path, ctx };
}

const handleAt = (address: string) => ({
  transportId: "moonraker",
  printerId: "p1",
  ref: "a.gcode",
  address,
});

async function drain(statuses: AsyncIterable<PrintStatus>): Promise<void> {
  for await (const _ of statuses);
}

describe("printer redirects are refused, never followed", () => {
  test.each(["/server/files/upload", "/printer/print/start"])(
    "moonraker submit: %s",
    async (path) => {
      const { address, followed } = servers([path]);
      const { path: file, ctx } = await gcode();
      const target = { id: "p1", transportId: "moonraker", address };
      await expect(moonraker.submit({ path: file, format: "gcode" }, target, ctx)).rejects.toThrow(
        "was redirected (302)",
      );
      expect(followed()).toBe(0);
    },
  );

  test("moonraker status fails at once instead of polling the redirect target", async () => {
    const { address, followed } = servers(["/printer/objects/query"]);
    await expect(drain(moonraker.status(handleAt(address)))).rejects.toThrow(
      "moonraker status query was redirected (302)",
    );
    expect(followed()).toBe(0);
  });

  test("moonraker cancel", async () => {
    const { address, followed } = servers(["/printer/print/cancel"]);
    await expect(moonraker.cancel?.(handleAt(address)) ?? Promise.resolve()).rejects.toThrow(
      "moonraker cancel was redirected (302)",
    );
    expect(followed()).toBe(0);
  });
});
