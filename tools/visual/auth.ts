import type { BrowserContext } from "playwright";
import type { Scene } from "./scene.ts";

export const SIGNED_OUT = { authEnabled: true, authenticated: false } as const;

export async function stubSignedOut(context: BrowserContext): Promise<void> {
  await context.route("**/auth/status", (route) => route.fulfill({ json: SIGNED_OUT }));
  await context.route("**/auth/login", (route) =>
    route.fulfill({ status: 401, json: { error: "invalid password" } }),
  );
}

export async function stubAuthDown(
  context: BrowserContext,
  { status, times, hang }: { status: number; times?: number; hang?: boolean },
): Promise<void> {
  let left = times ?? Number.POSITIVE_INFINITY;
  await context.route("**/auth/status", (route) => {
    if (left <= 0) return route.fallback();
    left -= 1;
    if (hang) return new Promise<void>(() => {});
    return route.fulfill({ status, json: {} });
  });
}

export async function stubAuth(context: BrowserContext, scene: Scene): Promise<void> {
  if (scene.signedOut) await stubSignedOut(context);
  if (scene.authDown) await stubAuthDown(context, scene.authDown);
}
