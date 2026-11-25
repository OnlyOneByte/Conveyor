import { afterAll, beforeAll } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
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
export const BROWSER_CLOSE_MS = 10_000;

export async function closeOrKill(
  close: () => Promise<void>,
  pid: number | undefined,
  kill: (pid: number) => void = (id) => process.kill(id, "SIGKILL"),
  ms = BROWSER_CLOSE_MS,
): Promise<"closed" | "killed"> {
  const closed = await Promise.race([close().then(() => true), Bun.sleep(ms).then(() => false)]);
  if (closed || pid === undefined) return "closed";
  kill(pid);
  return "killed";
}

export function childPids(parent = process.pid): number[] {
  if (!existsSync("/proc")) return [];
  return readdirSync("/proc").flatMap((name) => {
    if (!/^\d+$/.test(name)) return [];
    try {
      const stat = readFileSync(`/proc/${name}/stat`, "utf8");
      const ppid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
      return ppid === parent ? [Number(name)] : [];
    } catch {
      return [];
    }
  });
}

export function browserPages() {
  let browser: Browser | undefined;
  let pid: number | undefined;
  let failed = "";
  beforeAll(async () => {
    failed = `Chromium was still launching after ${BROWSER_SETUP_MS / 1000} s`;
    const before = new Set(childPids());
    browser = await chromium.launch().catch((err: unknown) => {
      failed = `Chromium didn't launch: ${messageOf(err)}`;
      throw err;
    });
    const launched = childPids().filter((child) => !before.has(child));
    pid = launched.length === 1 ? launched[0] : undefined;
    failed = "";
  }, BROWSER_SETUP_MS);
  afterAll(async () => {
    const opened = browser;
    if (!opened) return;
    if ((await closeOrKill(() => opened.close(), pid)) === "killed")
      console.error(
        `browserPages: Chromium ${pid} didn't close in ${BROWSER_CLOSE_MS / 1000} s, killed it`,
      );
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
