import { afterEach, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StageCtx } from "@conveyor/shared";
import { elegoo } from "./index.ts";

const stops: (() => void)[] = [];
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
});

test("an upload the printer redirects is refused, never followed", async () => {
  let followed = 0;
  const target = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      followed++;
      return new Response("ok");
    },
  });
  const printer = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      await req.arrayBuffer();
      return Response.redirect(`http://127.0.0.1:${target.port}/uploadFile/upload`, 302);
    },
  });
  stops.push(
    () => printer.stop(true),
    () => target.stop(true),
  );
  const dir = await mkdtemp(join(tmpdir(), "conveyor-elegoo-redirect-"));
  const path = join(dir, "a.gcode");
  await writeFile(path, "G28\n");
  const ctx: StageCtx = {
    jobId: "j",
    workDir: dir,
    signal: new AbortController().signal,
    report: () => {},
    log: () => {},
  };
  const printerTarget = {
    id: "e1",
    transportId: "elegoo",
    address: `127.0.0.1:${printer.port}`,
    secrets: {},
  };
  await expect(elegoo.submit({ path, format: "gcode" }, printerTarget, ctx)).rejects.toThrow(
    "elegoo upload was redirected (302)",
  );
  expect(followed).toBe(0);
});
