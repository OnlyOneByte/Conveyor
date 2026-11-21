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
