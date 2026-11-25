import { afterAll, beforeAll } from "bun:test";
import { readFileSync } from "node:fs";
import { type Browser, chromium, type Page } from "playwright";
import { PNG } from "pngjs";
import { messageOf } from "./errors.ts";

export function solid(width: number, height: number, rgb: [number, number, number]): Buffer {
  const png = new PNG({ width, height });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = rgb[0];
    png.data[i + 1] = rgb[1];
    png.data[i + 2] = rgb[2];
    png.data[i + 3] = 255;
  }
  return PNG.sync.write(png);
}

export const BROWSER_SETUP_MS = 30_000;

export function browserPages() {
  let browser: Browser | undefined;
  let failed = "";
  beforeAll(async () => {
    failed = `Chromium was still launching after ${BROWSER_SETUP_MS / 1000} s`;
    browser = await chromium.launch().catch((err: unknown) => {
      failed = `Chromium didn't launch: ${messageOf(err)}`;
      throw err;
    });
    failed = "";
  }, BROWSER_SETUP_MS);
  afterAll(async () => {
    await browser?.close();
  }, BROWSER_SETUP_MS);
  return async <T>(run: (page: Page) => Promise<T>): Promise<T> => {
    if (failed) throw new Error(`browserPages: ${failed}`);
    if (!browser) throw new Error("browserPages: call it at the top of a test file");
    const context = await browser.newContext({ viewport: { width: 400, height: 300 } });
    try {
      return await run(await context.newPage());
    } finally {
      await context.close();
    }
  };
}

export function serveCaddy(cmd: string[]): ReturnType<typeof Bun.serve> {
  const file = cmd[cmd.indexOf("-v") + 1]?.split(":")[0] ?? "";
  const port = Number(readFileSync(file, "utf8").match(/http:\/\/127\.0\.0\.1:(\d+)/)?.[1]);
  return Bun.serve({ hostname: "127.0.0.1", port, fetch: () => new Response("ok") });
}

export function fakeAdapt(cmd: string[]): { exitCode: number; stdout: Buffer; stderr: Buffer } {
  const text = readFileSync(cmd[cmd.indexOf("-v") + 1]?.split(":")[0] ?? "", "utf8");
  const port = text.match(/http:\/\/(127\.0\.0\.1:\d+)/)?.[1];
  const dials = [...text.matchAll(/reverse_proxy (\S+)/g)].map(([, dial]) => ({ dial }));
  const server = {
    listen: [port],
    routes: [{ upstreams: dials }],
    automatic_https: { disable: true },
  };
  const config = { admin: { disabled: true }, apps: { http: { servers: { srv0: server } } } };
  return { exitCode: 0, stdout: Buffer.from(JSON.stringify(config)), stderr: Buffer.from("") };
}
