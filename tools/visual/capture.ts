import { chromium, type Browser, type Page } from "playwright";
import { mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { framesToGif, hasFfmpeg, videoToGif, type Frame } from "./gif.ts";
import { HEIGHTS, WIDTHS, scenes, type Scene, type Step } from "./scenes.ts";
import { bootStack } from "./stack.ts";

export interface ShotResult {
  scene: string;
  width: number;
  png?: string;
  gif?: string;
  gifBytes?: number;
  error?: string;
}

export interface Manifest {
  url: string;
  gifMode: GifMode;
  results: ShotResult[];
}

type GifMode = "ffmpeg" | "frames";

const { values } = parseArgs({
  options: {
    url: { type: "string" },
    root: { type: "string", default: resolve(import.meta.dir, "../..") },
    out: { type: "string", default: resolve(process.cwd(), "visual-out") },
    only: { type: "string" },
    "gif-mode": { type: "string" },
    verbose: { type: "boolean", default: false },
  },
});

const outDir = resolve(values.out);
const gifMode: GifMode =
  values["gif-mode"] === "frames" || values["gif-mode"] === "ffmpeg"
    ? values["gif-mode"]
    : hasFfmpeg()
      ? "ffmpeg"
      : "frames";
const only = values.only?.split(",").map((s) => s.trim());
const selected = only ? scenes.filter((s) => only.includes(s.name)) : scenes;

async function runStep(page: Page, step: Step): Promise<void> {
  if ("click" in step) await page.locator(step.click).first().click();
  else if ("type" in step) await page.locator(step.type).first().fill(step.text);
  else if ("press" in step) await page.keyboard.press(step.press);
  else if ("scroll" in step) {
    const target = page.locator(step.scroll).first();
    await target.waitFor({ timeout: 15000 });
    await target.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "smooth" }));
  }
  else if ("waitFor" in step) {
    const wait = page.locator(step.waitFor).first().waitFor({ timeout: step.timeout ?? 15000 });
    await (step.optional ? wait.catch(() => undefined) : wait);
  }
  else await page.waitForTimeout(step.wait);
}

async function shoot(browser: Browser, base: string, scene: Scene, width: number): Promise<ShotResult> {
  const viewport = { width, height: HEIGHTS[width] ?? 900 };
  const result: ShotResult = { scene: scene.name, width };
  const stem = `${scene.name}-${width}`;
  const videoDir = scene.record && gifMode === "ffmpeg" ? await mkdtemp(join(tmpdir(), "conveyor-video-")) : undefined;
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    reducedMotion: "no-preference",
    ...(videoDir ? { recordVideo: { dir: videoDir, size: viewport } } : {}),
  });
  const page = await context.newPage();
  const frames: Frame[] = [];
  let sampling = false;
  let sampler: Promise<void> = Promise.resolve();
  try {
    await page.goto(new URL(scene.route, base).toString(), { waitUntil: "load" });
    await page.locator(scene.ready).first().waitFor({ timeout: 30000 });
    sampling = scene.record === true && gifMode === "frames";
    sampler = (async () => {
      while (sampling) {
        try {
          frames.push({ png: await page.screenshot({ type: "png", timeout: 3000 }), at: Date.now() });
        } catch (e) {
          if (values.verbose) console.error(`[sampler] ${(e as Error).message.split("\n")[0]}`);
          await Bun.sleep(50);
        }
      }
    })();
    for (const step of scene.steps ?? []) await runStep(page, step);
    sampling = false;
    await sampler;
    result.png = `${stem}.png`;
    await page.screenshot({ path: join(outDir, result.png), fullPage: scene.fullPage ?? true });
  } catch (err) {
    result.error = (err as Error).message.split("\n")[0];
    sampling = false;
    await sampler;
    result.png = `${stem}.png`;
    await page.screenshot({ path: join(outDir, result.png), fullPage: true }).catch(() => (result.png = undefined));
  }
  const video = page.video();
  await context.close();
  if (scene.record && !result.error) {
    result.gif = `${stem}.gif`;
    const gifPath = join(outDir, result.gif);
    try {
      if (video && videoDir) {
        const webm = join(videoDir, `${stem}.webm`);
        await rename(await video.path(), webm);
        result.gifBytes = await videoToGif(webm, gifPath);
      } else {
        result.gifBytes = await framesToGif(frames, gifPath);
      }
    } catch (err) {
      result.gif = undefined;
      result.error = `gif: ${(err as Error).message.split("\n")[0]}`;
    }
  }
  if (videoDir) await rm(videoDir, { recursive: true, force: true });
  return result;
}

async function warmUp(browser: Browser, base: string): Promise<void> {
  const page = await browser.newPage();
  const seen = new Set<string>();
  for (const scene of selected) {
    if (seen.has(scene.route)) continue;
    seen.add(scene.route);
    await page.goto(new URL(scene.route, base).toString(), { waitUntil: "load", timeout: 120000 });
    await page.locator(scene.ready).first().waitFor({ timeout: 120000 }).catch(() => undefined);
  }
  await page.close();
}

async function main(): Promise<number> {
  await mkdir(outDir, { recursive: true });
  const log = values.verbose ? (line: string) => console.error(line) : () => {};
  const stack = values.url ? { url: values.url, stop: async () => {} } : await bootStack(resolve(values.root), log);
  const browser = await chromium.launch();
  const results: ShotResult[] = [];
  try {
    await warmUp(browser, stack.url);
    for (const width of WIDTHS) {
      for (const scene of selected) {
        const r = await shoot(browser, stack.url, scene, width);
        results.push(r);
        const extra = r.gif ? ` + ${r.gif} (${((r.gifBytes ?? 0) / 1024).toFixed(0)} KiB)` : "";
        console.log(`${r.error ? "FAIL" : "ok  "} ${r.scene}@${r.width} ${r.png ?? "-"}${extra}${r.error ? ` :: ${r.error}` : ""}`);
      }
    }
  } finally {
    await browser.close();
    await stack.stop();
  }
  const manifest: Manifest = { url: stack.url, gifMode, results };
  await Bun.write(join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return results.some((r) => r.error) ? 1 : 0;
}

process.exit(await main());
