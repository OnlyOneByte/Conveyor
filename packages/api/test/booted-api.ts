import { Database } from "bun:sqlite";
import { join } from "node:path";

export const job = {
  generator: { id: "gridfinity", params: {} },
  printerId: "klipper-garage",
  profileId: "orca/klipper-pla-0.2",
};

export async function login(base: string, password: string): Promise<string> {
  const res = await fetch(`${base}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });
  return (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

export function jobRows(dir: string): number {
  const db = new Database(join(dir, "conveyor.db"), { readonly: true });
  try {
    return db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM jobs").get()?.n ?? -1;
  } finally {
    db.close();
  }
}

export interface BootedApi {
  base: string;
  stop(): Promise<void>;
}

export async function bootApi(dir: string, env: Record<string, string>): Promise<BootedApi> {
  const api = Bun.spawn([process.execPath, join(import.meta.dir, "..", "src", "index.ts")], {
    cwd: dir,
    env: {
      ...process.env,
      CONVEYOR_HOST: "127.0.0.1",
      PORT: "0",
      DB_PATH: join(dir, "conveyor.db"),
      DATA_DIR: dir,
      REDIS_URL: "redis://127.0.0.1:1",
      ...env,
    },
    stdout: "pipe",
    stderr: "ignore",
  });
  const reader = api.stdout.getReader();
  const decoder = new TextDecoder();
  let seen = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) throw new Error(`api exited before listening: ${seen}`);
    seen += decoder.decode(value);
    const match = seen.match(/listening at (http:\/\/127\.0\.0\.1:\d+)/);
    if (match?.[1]) {
      void (async () => {
        while (!(await reader.read()).done) {}
      })();
      return {
        base: match[1],
        stop: async () => {
          api.kill();
          await api.exited;
        },
      };
    }
  }
}
