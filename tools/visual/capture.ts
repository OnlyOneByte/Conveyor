import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { type Browser, chromium, type Page } from "playwright";
import { stubSignedOut } from "./auth.ts";
import { messageOf } from "./errors.ts";
import { follow } from "./follow.ts";
import { type Frame, framesToGif } from "./gif.ts";
import { CAPTURE_NOW, pinHistoryRoute } from "./history.ts";
import { assertHits, titleMismatch } from "./hits.ts";
import { assertHolds } from "./holds.ts";
import { HEIGHTS, type Scene, type Step, scenes, WIDTHS } from "./scenes.ts";
import { bootStack } from "./stack.ts";

export interface ShotResult {
  scene: string;
  width: number;
  png?: string;
  gif?: string;
  gifBytes?: number;
  error?: string;
  warnings: string[];
}

export interface Manifest {
  url: string;
  warnings: string[];
  results: ShotResult[];
}

interface Sampler {
  frames: Frame[];
  stop: () => Promise<void>;
}

interface ShotOptions {
  browser: Browser;
  base: string;
  scene: Scene;
  width: number;
}

const { values } = parseArgs({
  options: {
    url: { type: "string" },
    root: { type: "string", default: resolve(import.meta.dir, "../..") },
    out: { type: "string", default: resolve(process.cwd(), "visual-out") },
    only: { type: "string" },
    verbose: { type: "boolean", default: false },
    scheme: { type: "string", default: "light" },
  },
});

const colorScheme = values.scheme === "dark" ? "dark" : "light";

const outDir = resolve(values.out);
const only = values.only?.split(",").map((s) => s.trim());
const selected = only ? scenes.filter((s) => only.includes(s.name)) : scenes;
const unshot = selected
  .filter((s) => !WIDTHS.some((w) => !s.widths || s.widths.includes(w)))
  .map((s) => s.name);
if (unshot.length) throw new Error(`scenes shot at no width: ${unshot.join(", ")}`);

async function runStep(page: Page, step: Step, warnings: string[]): Promise<void> {
  if ("click" in step) await page.locator(step.click).first().click();
  else if ("type" in step) await page.locator(step.type).first().fill(step.text);
  else if ("press" in step) await page.keyboard.press(step.press);
  else if ("hover" in step) await page.locator(step.hover).first().hover();
  else if ("scroll" in step)
    await page.locator(step.scroll).first().scrollIntoViewIfNeeded({ timeout: 15000 });
  else if ("waitFor" in step) await waitForStep(page, step, warnings);
  else if ("hits" in step) await assertHits(page, step.hits, step.viewports);
  else if ("follow" in step) await follow(page, step.follow);
  else if ("fulfill" in step)
    await page.route(step.fulfill, (route) =>
      step.method && route.request().method() !== step.method
        ? route.fallback()
        : route.fulfill({ status: step.status, json: step.json }),
    );
  else if ("history" in step) await (step.history === "back" ? page.goBack() : page.goForward());
  else if ("holds" in step) await assertHolds(page, step);
  else await page.waitForTimeout(step.wait);
}

async function waitForStep(
  page: Page,
  step: { waitFor: string; timeout?: number; warn?: string },
  warnings: string[],
): Promise<void> {
  try {
    await page
      .locator(step.waitFor)
      .first()
      .waitFor({ timeout: step.timeout ?? 15000 });
  } catch (err) {
    if (!step.warn) throw err;
    warnings.push(step.warn);
  }
}

function startSampler(page: Page, warnings: string[]): Sampler {
  const frames: Frame[] = [];
  let running = true;
  let failures = 0;
  let lastFailure = "";
  const loop = (async () => {
    while (running) {
      try {
        frames.push({ png: await page.screenshot({ type: "png", timeout: 3000 }), at: Date.now() });
      } catch (err) {
        failures++;
        lastFailure = messageOf(err);
        await Bun.sleep(50);
      }
    }
  })();
  const stop = async () => {
    if (!running) return;
    running = false;
    await loop;
    if (failures > 0) warnings.push(`${failures} GIF frame(s) failed to capture: ${lastFailure}`);
  };
  return { frames, stop };
}

async function writeGif(result: ShotResult, frames: Frame[]): Promise<void> {
  const name = `${result.scene}-${result.width}.gif`;
  try {
    result.gifBytes = await framesToGif(frames, join(outDir, name));
    result.gif = name;
  } catch (err) {
    result.error = `gif: ${messageOf(err)}`;
  }
}

async function writePng(page: Page, result: ShotResult, fullPage: boolean): Promise<void> {
  const name = `${result.scene}-${result.width}.png`;
  try {
    await page.screenshot({ path: join(outDir, name), fullPage });
    result.png = name;
  } catch (err) {
    const reason = `screenshot: ${messageOf(err)}`;
    result.error = result.error ? `${result.error}; ${reason}` : reason;
  }
}

async function shoot({ browser, base, scene, width }: ShotOptions): Promise<ShotResult> {
  const result: ShotResult = { scene: scene.name, width, warnings: [] };
  const context = await browser.newContext({
    viewport: { width, height: HEIGHTS[width] ?? 900 },
    deviceScaleFactor: 1,
    colorScheme,
  });
  await pinHistoryRoute(context);
  await context.clock.setFixedTime(CAPTURE_NOW);
  if (scene.signedOut) await stubSignedOut(context);
  const page = await context.newPage();
  let sampler: Sampler | undefined;
  try {
    await page.goto(new URL(scene.route, base).toString(), { waitUntil: "load" });
    await page.locator(scene.ready).first().waitFor({ timeout: 30000 });
    if (scene.record) sampler = startSampler(page, result.warnings);
    for (const step of scene.steps ?? []) await runStep(page, step, result.warnings);
    const mismatch = await titleMismatch(page);
    if (mismatch) throw new Error(mismatch);
  } catch (err) {
    result.error = messageOf(err);
  }
  await sampler?.stop();
  await writePng(page, result, scene.fullPage ?? true);
  await context.close();
  if (sampler && !result.error) await writeGif(result, sampler.frames);
  return result;
}

async function warmUp(browser: Browser, base: string): Promise<string[]> {
  const page = await browser.newPage();
  const warnings: string[] = [];
  for (const route of new Set(selected.map((s) => s.route))) {
    const ready = selected.find((s) => s.route === route)?.ready ?? "body";
    try {
      await page.goto(new URL(route, base).toString(), { waitUntil: "load", timeout: 120000 });
      await page.locator(ready).first().waitFor({ timeout: 120000 });
    } catch (err) {
      warnings.push(`warm-up ${route}: ${messageOf(err)}`);
    }
  }
  await page.close();
  return warnings;
}

function describe(r: ShotResult): string {
  const gif = r.gif ? ` + ${r.gif} (${((r.gifBytes ?? 0) / 1024).toFixed(0)} KiB)` : "";
  const error = r.error ? ` :: ${r.error}` : "";
  const warn = r.warnings.length ? ` [warn: ${r.warnings.join("; ")}]` : "";
  return `${r.error ? "FAIL" : "ok  "} ${r.scene}@${r.width} ${r.png ?? "-"}${gif}${error}${warn}`;
}

async function main(): Promise<number> {
  await mkdir(outDir, { recursive: true });
  const log = values.verbose ? (line: string) => console.error(line) : () => {};
  const stack = values.url
    ? { url: values.url, stop: async () => {} }
    : await bootStack(resolve(values.root), log);
  const browser = await chromium.launch();
  const results: ShotResult[] = [];
  let warnings: string[] = [];
  try {
    warnings = await warmUp(browser, stack.url);
    for (const w of warnings) console.log(`warn ${w}`);
    for (const width of WIDTHS) {
      for (const scene of selected.filter((s) => !s.widths || s.widths.includes(width))) {
        const r = await shoot({ browser, base: stack.url, scene, width });
        results.push(r);
        console.log(describe(r));
      }
    }
  } finally {
    await browser.close();
    await stack.stop();
  }
  const manifest: Manifest = { url: stack.url, warnings, results };
  await Bun.write(join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return results.some((r) => r.error) ? 1 : 0;
}

process.exit(await main());
