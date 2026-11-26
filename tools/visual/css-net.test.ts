import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { caddyErrors, cssReport, needsServiceWorker, noteNetwork, watchCss } from "./css-net.ts";
import { scenes } from "./scenes.ts";

type Listener = (value: never) => void;

function fakePage() {
  const listeners = new Map<string, Listener[]>();
  const page = {
    on(event: string, listener: Listener) {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      return page;
    },
  };
  const emit = (event: string, value: unknown) => {
    for (const listener of listeners.get(event) ?? []) listener(value as never);
  };
  return { page, emit };
}

const request = (url: string, type = "stylesheet", errorText?: string) => ({
  url: () => url,
  resourceType: () => type,
  failure: () => (errorText ? { errorText } : null),
});

const response = (url: string, status: number, type = "stylesheet") => ({
  url: () => url,
  status: () => status,
  request: () => request(url, type),
});

test("records each CSS request that failed or answered other than 200", () => {
  const { page, emit } = fakePage();
  const problems = watchCss(page);
  emit(
    "requestfailed",
    request("http://x/_app/immutable/assets/Menu.G1hA2JiC.css", "stylesheet", "net::ERR_ABORTED"),
  );
  emit(
    "requestfailed",
    request("http://x/_app/immutable/chunks/app.js", "script", "net::ERR_FAILED"),
  );
  emit("response", response("http://x/_app/immutable/assets/Demo.DuBZ85RU.css", 502));
  emit("response", response("http://x/_app/immutable/assets/0.css", 200));
  emit("response", response("http://x/api/jobs", 500, "fetch"));
  emit("requestfailed", request("http://x/theme.css?v=2", "other", "net::ERR_EMPTY_RESPONSE"));
  expect(problems()).toEqual([
    "Menu.G1hA2JiC.css failed: net::ERR_ABORTED",
    "Demo.DuBZ85RU.css answered HTTP 502",
    "theme.css failed: net::ERR_EMPTY_RESPONSE",
  ]);
  expect(cssReport(problems())).toBe(
    "CSS requests: Menu.G1hA2JiC.css failed: net::ERR_ABORTED; Demo.DuBZ85RU.css answered HTTP 502; theme.css failed: net::ERR_EMPTY_RESPONSE",
  );
});

test("says so when no CSS request went wrong", () => {
  expect(cssReport([])).toBe("CSS requests: none failed and none answered other than 200");
});

test("only scenes that go offline through the service worker keep it", () => {
  const kept = scenes.filter(needsServiceWorker).map((s) => s.name);
  expect(kept.length).toBeGreaterThan(0);
  for (const scene of scenes) {
    const offline = (scene.steps ?? []).filter((step) => "offline" in step);
    const worker = offline.some((step) => "offline" in step && step.only !== "editor");
    expect(needsServiceWorker(scene)).toBe(worker);
  }
  expect(needsServiceWorker({ name: "x", route: "/", ready: "h1" })).toBe(false);
  expect(
    needsServiceWorker({
      name: "x",
      route: "/",
      ready: "h1",
      steps: [{ offline: "h1", only: "editor" }],
    }),
  ).toBe(false);
  expect(
    needsServiceWorker({ name: "x", route: "/", ready: "h1", steps: [{ offline: "h1" }] }),
  ).toBe(true);
});

test("keeps Caddy's error lines from the shot's start on", () => {
  const logs = [
    '{"level":"error","ts":1000.5,"msg":"old"}',
    '{"level":"info","ts":2000.1,"msg":"handled"}',
    '{"level":"error","ts":2000.2,"logger":"http.handlers.reverse_proxy","msg":"aborting with incomplete response"}',
    '{"level":"error","msg":"no timestamp"}',
    "",
  ].join("\n");
  expect(caddyErrors(logs, 2_000_000)).toEqual([
    '{"level":"error","ts":2000.2,"logger":"http.handlers.reverse_proxy","msg":"aborting with incomplete response"}',
    '{"level":"error","msg":"no timestamp"}',
  ]);
});

test("a failed shot's error names its CSS requests and Caddy's errors, saved beside the shot", async () => {
  const dir = mkdtempSync(join(tmpdir(), "conveyor-css-net-"));
  try {
    const path = join(dir, "s-390.caddy.log");
    const logs = () => '{"level":"error","ts":5,"msg":"aborting with incomplete response"}\n';
    expect(
      await noteNetwork("styles not applied", ["a.css answered HTTP 502"], {
        logs,
        since: 0,
        path,
      }),
    ).toBe(
      "styles not applied. CSS requests: a.css answered HTTP 502. Caddy logged 1 error line(s) during the shot (s-390.caddy.log)",
    );
    expect(readFileSync(path, "utf8")).toBe(`${logs().trim()}\n`);
    expect(await noteNetwork("boom", [])).toBe(
      "boom. CSS requests: none failed and none answered other than 200",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
