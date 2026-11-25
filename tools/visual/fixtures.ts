import { readFileSync } from "node:fs";
import { chromium, type Page } from "playwright";
import { PNG } from "pngjs";

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

export async function withPage<T>(run: (page: Page) => Promise<T>): Promise<T> {
  const browser = await chromium.launch();
  try {
    return await run(await browser.newPage({ viewport: { width: 400, height: 300 } }));
  } finally {
    await browser.close();
  }
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
