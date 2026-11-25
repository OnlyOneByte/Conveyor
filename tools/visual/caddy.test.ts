import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CADDY_IMAGE, caddyRun, visualCaddyfile } from "./caddy.ts";

const production = readFileSync(join(import.meta.dir, "../../Caddyfile"), "utf8");
const ports = { port: 41000, apiPort: 41001, webPort: 41002 };

test("the visual Caddyfile is production's, served on loopback over http to the stack's ports", () => {
  const visual = visualCaddyfile(production, ports);
  expect(visual).toContain("http://127.0.0.1:41000 {\n\tbind 127.0.0.1");
  expect(visual).toContain("reverse_proxy 127.0.0.1:41001");
  expect(visual).toContain("reverse_proxy 127.0.0.1:41002");
  expect(visual).toContain("admin off");
  expect(visual).not.toMatch(/api:3000|web:3000|CONVEYOR_DOMAIN/);
  for (const kept of ["encode gzip zstd", "X-Frame-Options DENY", "handle_path /api/*"])
    expect(visual).toContain(kept);
});

test("a Caddyfile that changed shape fails instead of serving something else", () => {
  expect(() => visualCaddyfile(production.replace("web:3000", "web:8080"), ports)).toThrow(
    'Caddyfile changed shape: expected exactly one "reverse_proxy web:3000"',
  );
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
