import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootApi } from "../../test/helpers/booted-api.ts";

const dirs: string[] = [];
const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), "conveyor-api-caddy-hosts-"));
  dirs.push(dir);
  return dir;
};

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

async function statuses(domain: string, hosts: string[]): Promise<number[]> {
  const api = await bootApi(scratch(), { CONVEYOR_AUTH: "disabled", CONVEYOR_DOMAIN: domain });
  try {
    const out: number[] = [];
    for (const host of hosts) {
      const res = await fetch(`${api.base}/health`, { headers: { host } });
      out.push(res.status);
    }
    return out;
  } finally {
    await api.stop();
  }
}

describe("booting with a CONVEYOR_DOMAIN Caddy accepts", () => {
  test("an any-host :443 boots and serves only the loopback names", async () => {
    expect(await statuses(":443", ["localhost", "conveyor.example"])).toEqual([200, 421]);
  });

  test("an https:// wildcard boots and serves names under it, but not its own name", async () => {
    const hosts = ["printer.example.com", "a.b.example.com", "example.com", "evilexample.com"];
    expect(await statuses("https://*.example.com", hosts)).toEqual([200, 200, 421, 421]);
  });

  test("an http:// address with a port boots and serves its host", async () => {
    expect(await statuses("http://my_printer.lan:8080", ["my_printer.lan:8080"])).toEqual([200]);
  });
});

describe("booting with a CONVEYOR_ALLOWED_HOSTS entry that isn't a host", () => {
  test("stops with a message that names the variable and the fix", () => {
    const dir = scratch();
    const result = Bun.spawnSync({
      cmd: [process.execPath, join(import.meta.dir, "..", "index.ts")],
      cwd: dir,
      env: {
        ...process.env,
        CONVEYOR_AUTH: "disabled",
        CONVEYOR_HOST: "127.0.0.1",
        PORT: "0",
        DB_PATH: join(dir, "conveyor.db"),
        DATA_DIR: dir,
        REDIS_URL: "redis://127.0.0.1:1",
        CONVEYOR_ALLOWED_HOSTS: "printer.lan/admin",
      },
      stdout: "pipe",
      stderr: "pipe",
      timeout: 10_000,
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain(
      'CONVEYOR_ALLOWED_HOSTS has entries that aren\'t host names or IP addresses: "printer.lan/admin". List names like printer.lan',
    );
  });
});
