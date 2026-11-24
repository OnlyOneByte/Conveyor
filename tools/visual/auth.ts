import type { BrowserContext } from "playwright";

export const SIGNED_OUT = { authEnabled: true, authenticated: false } as const;

export async function stubSignedOut(context: BrowserContext): Promise<void> {
  await context.route("**/auth/status", (route) => route.fulfill({ json: SIGNED_OUT }));
  await context.route("**/auth/login", (route) =>
    route.fulfill({ status: 401, json: { error: "invalid password" } }),
  );
}
