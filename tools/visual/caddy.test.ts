import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertLoopbackCaddy,
  CADDY_IMAGE,
  caddyRun,
  composeCaddyImage,
  visualCaddyfile,
} from "./caddy.ts";

const production = readFileSync(join(import.meta.dir, "../../Caddyfile"), "utf8");
const ports = { port: 41000, apiPort: 41001, webPort: 41002 };
const dir = mkdtempSync(join(tmpdir(), "conveyor-caddy-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const docker = (cmd: string[]) => Bun.spawnSync(cmd);
const checked = (source: string) => {
  const file = join(dir, `Caddyfile-${Math.random().toString(36).slice(2)}`);
  writeFileSync(file, visualCaddyfile(source, ports));
  return () => assertLoopbackCaddy(docker, file, ports);
};
const ADAPT_MS = 60000;

test("the visual Caddyfile is production's, served on loopback over http to the stack's ports", () => {
  const visual = visualCaddyfile(production, ports);
  expect(visual).toContain("http://127.0.0.1:41000 {\n\tbind 127.0.0.1");
  expect(visual).toContain("reverse_proxy 127.0.0.1:41001");
  expect(visual).toContain("reverse_proxy 127.0.0.1:41002");
  expect(visual).toContain("admin off\n\tauto_https off");
  expect(visual).not.toMatch(/api:3000|web:3000|CONVEYOR_DOMAIN/);
  for (const kept of ["encode gzip zstd", "X-Frame-Options DENY", "handle_path /api/*"])
    expect(visual).toContain(kept);
});

test("a Caddyfile that changed shape fails instead of serving something else", () => {
  expect(() => visualCaddyfile(production.replace("web:3000", "web:8080"), ports)).toThrow(
    'Caddyfile changed shape: expected exactly one "reverse_proxy web:3000"',
  );
});

test(
  "caddy adapt of the rewritten production Caddyfile is loopback-only",
  () => expect(checked(production)).not.toThrow(),
  ADAPT_MS,
);

const variants: [string, string, string][] = [
  ["an extra site", `${production}\n:8099 {\n\trespond ok\n}\n`, "2 servers, not 1"],
  [
    "an extra upstream",
    production.replace(
      "\thandle {",
      "\thandle_path /x/* {\n\t\treverse_proxy 10.0.0.5:80\n\t}\n\n\thandle {",
    ),
    "an upstream at 10.0.0.5:80",
  ],
  [
    "server metrics",
    production.replace("skip_install_trust", "skip_install_trust\n\tservers {\n\t\tmetrics\n\t}"),
    'http option "metrics"',
  ],
  [
    "dynamic upstreams",
    production.replace(
      "\thandle {",
      "\thandle_path /x/* {\n\t\treverse_proxy {\n\t\t\tdynamic a example.com 80\n\t\t}\n\t}\n\n\thandle {",
    ),
    '("dynamic_upstreams")',
  ],
  [
    "a forward proxy",
    production.replace(
      "reverse_proxy api:3000",
      "reverse_proxy api:3000 {\n\t\t\ttransport http {\n\t\t\t\tforward_proxy_url http://10.0.0.9:3128\n\t\t\t}\n\t\t}",
    ),
    "a proxy that can leave the stack",
  ],
  [
    "a network proxy",
    production.replace(
      "reverse_proxy api:3000",
      "reverse_proxy api:3000 {\n\t\t\ttransport http {\n\t\t\t\tnetwork_proxy url http://10.0.0.9:3128\n\t\t\t}\n\t\t}",
    ),
    '("network_proxy")',
  ],
  [
    "an admin address",
    production.replace("skip_install_trust", "skip_install_trust\n\tadmin 0.0.0.0:2019"),
    "the admin API isn't disabled",
  ],
];

for (const [name, source, message] of variants)
  test(
    `a production Caddyfile with ${name} refuses to start`,
    () => expect(checked(source)).toThrow(message),
    ADAPT_MS,
  );

test("Caddy runs on the host network with the file mounted read-only", () => {
  expect(caddyRun("/tmp/x/Caddyfile")).toEqual([
    "docker",
    "run",
    "-d",
    "--rm",
    "--network",
    "host",
    "-v",
    "/tmp/x/Caddyfile:/etc/caddy/Caddyfile:ro",
    CADDY_IMAGE,
  ]);
});

test("the stack runs compose's caddy image, pinned by digest so Dependabot moves both", () => {
  const compose = readFileSync(join(import.meta.dir, "../../docker-compose.yml"), "utf8");
  expect(CADDY_IMAGE).toMatch(/^caddy:2@sha256:[0-9a-f]{64}$/);
  expect(composeCaddyImage(compose)).toBe(CADDY_IMAGE);
  expect(() => composeCaddyImage("    image: caddy:2\n")).toThrow("isn't pinned by digest");
  const pinned = `caddy:2@sha256:${"a".repeat(64)}`;
  const two = `    image: ${pinned}\n    image: caddy:2@sha256:${"b".repeat(64)}\n`;
  expect(() => composeCaddyImage(two)).toThrow("2 caddy images, not one");
  expect(() => composeCaddyImage("    image: redis:8\n")).toThrow("0 caddy images");
});
