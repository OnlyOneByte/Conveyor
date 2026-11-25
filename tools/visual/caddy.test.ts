import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  adaptedProblem,
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

const files = new Map<string, string>();
const adapted = new Map<string, { exitCode: number; stdout: Buffer; stderr: Buffer }>();
const fileOf = (cmd: string[]) => cmd[cmd.indexOf("-v") + 1]?.split(":")[0] ?? "";
const fromBatch = (cmd: string[]) => {
  const result = adapted.get(fileOf(cmd));
  if (!result) throw new Error(`no batched caddy adapt for ${fileOf(cmd)}`);
  return result;
};
const checked = (source: string) => {
  const file = join(dir, "in", `Caddyfile-${files.size}`);
  files.set(file, visualCaddyfile(source, ports));
  return () => assertLoopbackCaddy(fromBatch, file, ports);
};
const ADAPT_MS = 120000;

beforeAll(() => {
  mkdirSync(join(dir, "in"));
  mkdirSync(join(dir, "out"));
  for (const [file, text] of files) writeFileSync(file, text);
  const script =
    'for f in /in/*; do n=$(basename "$f"); caddy adapt --config "$f" > "/out/$n.json" 2> "/out/$n.err"; echo $? > "/out/$n.code"; done';
  const run = Bun.spawnSync([
    "docker",
    "run",
    "--rm",
    "--network",
    "none",
    "-v",
    `${join(dir, "in")}:/in:ro`,
    "-v",
    `${join(dir, "out")}:/out`,
    CADDY_IMAGE,
    "sh",
    "-c",
    script,
  ]);
  if (run.exitCode !== 0) throw new Error(`batched caddy adapt failed: ${run.stderr.toString()}`);
  for (const file of files.keys()) {
    const out = (ext: string) => readFileSync(join(dir, "out", `${basename(file)}.${ext}`));
    adapted.set(file, {
      exitCode: Number(out("code").toString().trim()),
      stdout: out("json"),
      stderr: out("err"),
    });
  }
}, ADAPT_MS);

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

const productionCheck = checked(production);
test("caddy adapt of the rewritten production Caddyfile is loopback-only", () =>
  expect(productionCheck).not.toThrow());

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
    'reverse_proxy option "dynamic_upstreams"',
  ],
  [
    "a forward proxy",
    production.replace(
      "reverse_proxy api:3000",
      "reverse_proxy api:3000 {\n\t\t\ttransport http {\n\t\t\t\tforward_proxy_url http://10.0.0.9:3128\n\t\t\t}\n\t\t}",
    ),
    'a protocol module production doesn\'t use ("http")',
  ],
  [
    "a network proxy",
    production.replace(
      "reverse_proxy api:3000",
      "reverse_proxy api:3000 {\n\t\t\ttransport http {\n\t\t\t\tnetwork_proxy url http://10.0.0.9:3128\n\t\t\t}\n\t\t}",
    ),
    'reverse_proxy option "transport"',
  ],
  [
    "a TLS trust pool fetched over http",
    production.replace(
      "reverse_proxy api:3000",
      "reverse_proxy api:3000 {\n\t\t\ttransport http {\n\t\t\t\ttls\n\t\t\t\ttls_trust_pool http {\n\t\t\t\t\tendpoints https://10.0.0.9/ca.pem\n\t\t\t\t}\n\t\t\t}\n\t\t}",
    ),
    'a provider module production doesn\'t use ("http")',
  ],
  [
    "health checks on another port",
    production.replace(
      "reverse_proxy api:3000",
      "reverse_proxy api:3000 {\n\t\t\thealth_uri /health\n\t\t\thealth_port 41009\n\t\t}",
    ),
    'reverse_proxy option "health_checks"',
  ],
  [
    "an ACME server",
    production.replace("\thandle {", "\thandle_path /acme/* {\n\t\tacme_server\n\t}\n\n\thandle {"),
    'a handler module production doesn\'t use ("acme_server")',
  ],
  [
    "an outside health-check upstream",
    production.replace(
      "reverse_proxy api:3000",
      "reverse_proxy api:3000 {\n\t\t\thealth_upstream 10.0.0.7:80\n\t\t\thealth_uri /\n\t\t}",
    ),
    "an upstream at 10.0.0.7:80",
  ],
  [
    "an admin address",
    production.replace("skip_install_trust", "skip_install_trust\n\tadmin 0.0.0.0:2019"),
    "the admin API isn't disabled",
  ],
];

for (const [name, source, message] of variants) {
  const check = checked(source);
  test(`a production Caddyfile with ${name} refuses to start`, () =>
    expect(check).toThrow(message));
}

test("a module or option refusal names the allowlist to edit, and only that refusal does", () => {
  const config = (handler: Record<string, unknown>, admin: Record<string, unknown>) => ({
    admin,
    apps: {
      http: {
        servers: {
          srv0: {
            listen: ["127.0.0.1:41000"],
            automatic_https: { disable: true },
            routes: [{ handle: [handler] }],
          },
        },
      },
    },
  });
  const hint = "add it to MODULES (or the reverse_proxy options) in tools/visual/caddy.ts";
  const disabled = { disabled: true };
  expect(adaptedProblem(config({ handler: "acme_server" }, disabled), ports)).toContain(hint);
  expect(
    adaptedProblem(config({ handler: "reverse_proxy", health_checks: {} }, disabled), ports),
  ).toContain(hint);
  expect(adaptedProblem(config({ handler: "headers" }, {}), ports)).not.toContain(hint);
  expect(adaptedProblem(config({ handler: "headers" }, disabled), ports)).toBeNull();
});

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
});

test("compose's caddy image is read from the caddy service, quoted or commented", () => {
  const pinned = `caddy:2@sha256:${"a".repeat(64)}`;
  const other = `caddy:2@sha256:${"b".repeat(64)}`;
  const compose = (caddy: string, init = pinned) =>
    `services:\n  caddy-init:\n    image: ${init}\n  caddy:\n    image: ${caddy}\n  redis:\n    image: redis:8\n`;
  expect(() => composeCaddyImage(compose(pinned, other))).toThrow(
    `docker-compose.yml's caddy-init runs ${other}, not the caddy service's ${pinned}`,
  );
  expect(composeCaddyImage(compose(`"${pinned}"`))).toBe(pinned);
  expect(composeCaddyImage(compose(`'${pinned}' # bumped by Dependabot`))).toBe(pinned);
  expect(composeCaddyImage(compose(`${pinned}  # bumped by Dependabot`))).toBe(pinned);
  expect(() => composeCaddyImage(compose('"caddy:2" # floating'))).toThrow(
    "isn't pinned by digest",
  );
  expect(() => composeCaddyImage(compose("redis:8"))).toThrow("has no caddy image");
  expect(() => composeCaddyImage(`services:\n  caddy-init:\n    image: ${pinned}\n`)).toThrow(
    "has no caddy image",
  );
});
