import { API } from "./api.js";

export class LoginError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function errorText(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null || !("error" in body)) return undefined;
  return typeof body.error === "string" ? body.error : undefined;
}

export async function login(password: string): Promise<void> {
  const r = await fetch(`${API}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password }),
  });
  if (!r.ok) {
    const body: unknown = await r.json().catch(() => undefined);
    throw new LoginError(errorText(body) ?? `login failed (${r.status})`, r.status);
  }
}
