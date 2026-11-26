import { mkdir } from "node:fs/promises";
import { basename, dirname } from "node:path";
import type { Scene } from "./scene.ts";

export interface CssRequest {
  url(): string;
  resourceType(): string;
  failure(): { errorText: string } | null;
}

export interface CssResponse {
  url(): string;
  status(): number;
  request(): CssRequest;
}

export interface CssEvents {
  on(event: "requestfailed", listener: (request: CssRequest) => void): unknown;
  on(event: "response", listener: (response: CssResponse) => void): unknown;
}

export interface CaddyLog {
  read: (sinceMs: number) => string;
  path: string;
}

export interface ShotNetwork {
  failed: (request: CssRequest) => void;
  response: (response: CssResponse) => void;
  note: (error: string) => Promise<string>;
}

const isCss = (request: CssRequest) =>
  request.resourceType() === "stylesheet" || new URL(request.url()).pathname.endsWith(".css");

const named = (url: string) => new URL(url).pathname.split("/").pop() ?? url;

export function cssReport(problems: string[]): string {
  return problems.length === 0
    ? "CSS requests: none failed and none answered other than 200"
    : `CSS requests: ${problems.join("; ")}`;
}

export function needsServiceWorker(scene: Scene): boolean {
  return (scene.steps ?? []).some((step) => "offline" in step && step.only !== "editor");
}

const prop = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null
    ? Object.entries(value).find(([name]) => name === key)?.[1]
    : undefined;
const text = (value: unknown) => (typeof value === "string" ? value : undefined);
const count = (value: unknown) => (typeof value === "number" ? value : undefined);

function readJson(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

const noQuery = (text: string) => text.replace(/\?[^\s"]*/g, "?…");

export function caddyErrors(logs: string, since: number): string[] {
  return logs.split("\n").flatMap((line) => {
    const json = readJson(line);
    const ts = count(prop(json, "ts"));
    if (text(prop(json, "level")) !== "error" || ts === undefined || ts * 1000 < since) return [];
    const request = prop(json, "request");
    const kept = {
      level: "error",
      ts,
      logger: text(prop(json, "logger")),
      msg: text(prop(json, "msg")),
      status: count(prop(json, "status")),
      method: text(prop(request, "method")),
      path: text(prop(request, "uri"))?.split("?")[0],
      error: text(prop(json, "error")),
    };
    return [
      JSON.stringify(kept, (_key, value) => (typeof value === "string" ? noQuery(value) : value)),
    ];
  });
}

export function shotNetwork(caddy?: CaddyLog, now: () => number = Date.now): ShotNetwork {
  const since = now();
  const problems: string[] = [];
  return {
    failed: (request) => {
      if (isCss(request))
        problems.push(
          `${named(request.url())} failed: ${request.failure()?.errorText ?? "no error text"}`,
        );
    },
    response: (response) => {
      if (isCss(response.request()) && response.status() !== 200)
        problems.push(`${named(response.url())} answered HTTP ${response.status()}`);
    },
    note: async (error) => {
      const noted = `${error}. ${cssReport(problems)}`;
      if (!caddy) return noted;
      const lines = caddyErrors(caddy.read(since), since);
      await mkdir(dirname(caddy.path), { recursive: true });
      await Bun.write(caddy.path, lines.length ? `${lines.join("\n")}\n` : "");
      return `${noted}. Caddy logged ${lines.length} error line(s) during the shot (${basename(caddy.path)})`;
    },
  };
}

export function watchShot(page: CssEvents, caddy?: CaddyLog): ShotNetwork {
  const net = shotNetwork(caddy);
  page.on("requestfailed", net.failed);
  page.on("response", net.response);
  return net;
}

export const logsDir = (outDir: string) => `${outDir}-logs`;

declare const navigator: { serviceWorker?: { getRegistrations(): Promise<unknown[]> } };

export interface Evaluates {
  evaluate(fn: () => Promise<number>): Promise<number>;
}

export async function workerProblem(page: Evaluates, scene: Scene): Promise<string | null> {
  if (needsServiceWorker(scene)) return null;
  const workers = await page.evaluate(async () =>
    navigator.serviceWorker ? (await navigator.serviceWorker.getRegistrations()).length : 0,
  );
  return workers > 0
    ? `${workers} service worker(s) registered, but capture blocks them here`
    : null;
}

export interface ShotContextOptions {
  viewport: { width: number; height: number };
  deviceScaleFactor: number;
  colorScheme: "light" | "dark";
  reducedMotion: "reduce" | "no-preference";
  hasTouch?: boolean;
  isMobile?: boolean;
  serviceWorkers: "allow" | "block";
}

export function shotContextOptions(
  scene: Scene,
  viewport: { width: number; height: number },
  colorScheme: "light" | "dark",
): ShotContextOptions {
  return {
    viewport,
    deviceScaleFactor: 1,
    colorScheme,
    reducedMotion: scene.reducedMotion ? "reduce" : "no-preference",
    ...(scene.touch ? { hasTouch: true, isMobile: true } : {}),
    serviceWorkers: needsServiceWorker(scene) ? "allow" : "block",
  };
}
