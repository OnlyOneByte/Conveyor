import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type CssRequest,
  caddyErrors,
  cssReport,
  logsDir,
  needsServiceWorker,
  shotContextOptions,
  shotNetwork,
  watchShot,
  workerProblem,
} from "./css-net.ts";
import type { Scene } from "./scene.ts";
import { scenes } from "./scenes.ts";

const request = (url: string, type = "stylesheet", errorText?: string): CssRequest => ({
  url: () => url,
  resourceType: () => type,
  failure: () => (errorText ? { errorText } : null),
});

const response = (url: string, status: number, type = "stylesheet") => ({
  url: () => url,
  status: () => status,
  request: () => request(url, type),
});

const plain: Scene = { name: "plain", route: "/", ready: "h1" };
const offlineNav = scenes.find((scene) => scene.name === "offline-nav");

test("records each CSS request that failed or answered other than 200", async () => {
  const net = shotNetwork();
  net.failed(
    request("http://x/_app/immutable/assets/Menu.G1hA2JiC.css", "stylesheet", "net::ERR_ABORTED"),
  );
  net.failed(request("http://x/_app/immutable/chunks/app.js", "script", "net::ERR_FAILED"));
  net.response(response("http://x/_app/immutable/assets/Demo.DuBZ85RU.css", 502));
  net.response(response("http://x/_app/immutable/assets/0.css", 200));
  net.response(response("http://x/api/jobs", 500, "fetch"));
  net.failed(request("http://x/theme.css?v=2", "other", "net::ERR_EMPTY_RESPONSE"));
  expect(await net.note("styles not applied")).toBe(
    "styles not applied. CSS requests: Menu.G1hA2JiC.css failed: net::ERR_ABORTED; Demo.DuBZ85RU.css answered HTTP 502; theme.css failed: net::ERR_EMPTY_RESPONSE",
  );
  expect(await shotNetwork().note("boom")).toBe(`boom. ${cssReport([])}`);
  expect(cssReport([])).toBe("CSS requests: none failed and none answered other than 200");
});

test("watchShot listens for failed requests and responses on the page", async () => {
  const listeners = new Map<string, unknown>();
  const page = {
    on(event: string, listener: unknown) {
      listeners.set(event, listener);
      return page;
    },
  };
  const net = watchShot(page);
  expect([...listeners.keys()]).toEqual(["requestfailed", "response"]);
  const failed = listeners.get("requestfailed");
  const answered = listeners.get("response");
  if (typeof failed === "function")
    failed(request("http://x/a.css", "stylesheet", "net::ERR_FAILED"));
  if (typeof answered === "function") answered(response("http://x/b.css", 503));
  expect(await net.note("x")).toBe(
    "x. CSS requests: a.css failed: net::ERR_FAILED; b.css answered HTTP 503",
  );
});

test("a failed shot saves Caddy's errors from its own start, beside but outside the shots", async () => {
  const dir = mkdtempSync(join(tmpdir(), "conveyor-css-net-"));
  try {
    const path = join(logsDir(join(dir, "after")), "s-390.caddy.log");
    expect(path).toBe(join(dir, "after-logs", "s-390.caddy.log"));
    const reads: number[] = [];
    const read = (sinceMs: number) => {
      reads.push(sinceMs);
      return '{"level":"error","ts":5,"msg":"aborting with incomplete response"}\n';
    };
    const net = shotNetwork({ read, path }, () => 4000);
    expect(await net.note("styles not applied")).toBe(
      `styles not applied. ${cssReport([])}. Caddy logged 1 error line(s) during the shot (s-390.caddy.log)`,
    );
    expect(reads).toEqual([4000]);
    expect(readFileSync(path, "utf8")).toBe(
      '{"level":"error","ts":5,"msg":"aborting with incomplete response"}\n',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Caddy lines keep only the shot's errors, without query strings or headers", () => {
  const request = {
    method: "GET",
    uri: "/_app/immutable/assets/Menu.css?token=s3cret",
    headers: { "X-Api-Key": ["k3y"], Cookie: ["REDACTED"] },
  };
  const logs = [
    '{"level":"error","ts":1000.5,"msg":"old"}',
    '{"level":"info","ts":2000.1,"msg":"handled"}',
    JSON.stringify({
      level: "error",
      ts: 2000.2,
      logger: "http.log.error",
      msg: "dial tcp 127.0.0.1:1: connect: connection refused",
      status: 502,
      request,
      error: "GET /x?token=s3cret failed",
    }),
    "not json",
    '{"level":"error","msg":"no timestamp"}',
    "",
  ].join("\n");
  const kept = caddyErrors(logs, 2_000_000);
  expect(kept).toEqual([
    JSON.stringify({
      level: "error",
      ts: 2000.2,
      logger: "http.log.error",
      msg: "dial tcp 127.0.0.1:1: connect: connection refused",
      status: 502,
      method: "GET",
      path: "/_app/immutable/assets/Menu.css",
      error: "GET /x?… failed",
    }),
  ]);
  expect(kept.join("")).not.toContain("s3cret");
  expect(kept.join("")).not.toContain("k3y");
});

test("each shot's context blocks the service worker, except where a scene goes offline through it", () => {
  const options = shotContextOptions(plain, { width: 390, height: 844 }, "dark");
  expect(options).toEqual({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    colorScheme: "dark",
    reducedMotion: "no-preference",
    serviceWorkers: "block",
  });
  expect(
    offlineNav &&
      shotContextOptions(offlineNav, { width: 1440, height: 900 }, "light").serviceWorkers,
  ).toBe("allow");
  expect(
    shotContextOptions(
      { ...plain, touch: true, reducedMotion: true },
      { width: 390, height: 844 },
      "light",
    ),
  ).toMatchObject({
    hasTouch: true,
    isMobile: true,
    reducedMotion: "reduce",
    serviceWorkers: "block",
  });
});

test("only scenes that go offline through the service worker keep it", () => {
  const kept = scenes.filter(needsServiceWorker).map((s) => s.name);
  expect(kept).toContain("offline-nav");
  for (const scene of scenes) {
    const worker = (scene.steps ?? []).some((step) => "offline" in step && step.only !== "editor");
    expect(needsServiceWorker(scene)).toBe(worker);
  }
  expect(needsServiceWorker({ ...plain, steps: [{ offline: "h1", only: "editor" }] })).toBe(false);
  expect(needsServiceWorker({ ...plain, steps: [{ offline: "h1" }] })).toBe(true);
});

test("a registered worker fails a scene that blocks it, and is never asked about where it's kept", async () => {
  const page = (workers: number) => ({
    asked: 0,
    async evaluate() {
      this.asked++;
      return workers;
    },
  });
  expect(await workerProblem(page(1), plain)).toBe(
    "1 service worker(s) registered, but capture blocks them here",
  );
  expect(await workerProblem(page(0), plain)).toBeNull();
  const kept = page(1);
  expect(offlineNav && (await workerProblem(kept, offlineNav))).toBeNull();
  expect(kept.asked).toBe(0);
});
