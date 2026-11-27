import { isHashedAsset, needsServiceWorker } from "./css-net.ts";
import { messageOf } from "./errors.ts";
import type { Scene } from "./scene.ts";

export interface AssetRoute<R> {
  request(): { url(): string };
  fetch(): Promise<R>;
  fulfill(options: { response: R }): Promise<void>;
  abort(errorCode?: string): Promise<void>;
}

export interface RoutesAssets<R> {
  route(match: (url: URL) => boolean, handler: (route: AssetRoute<R>) => unknown): Promise<unknown>;
}

export type AssetFailed = (url: string, error: string) => void;

async function fetchTwice<R>(route: AssetRoute<R>): Promise<{ response: R } | { error: string }> {
  try {
    return { response: await route.fetch() };
  } catch {
    try {
      return { response: await route.fetch() };
    } catch (err) {
      return { error: messageOf(err) };
    }
  }
}

export async function serveAsset<R>(route: AssetRoute<R>, failed: AssetFailed): Promise<void> {
  const fetched = await fetchTwice(route);
  if ("response" in fetched) return route.fulfill({ response: fetched.response });
  failed(route.request().url(), fetched.error);
  return route.abort("failed");
}

export async function routeHashedAssets<R>(
  context: RoutesAssets<R>,
  scene: Scene,
  failed: AssetFailed,
): Promise<boolean> {
  if (needsServiceWorker(scene)) return false;
  await context.route(isHashedAsset, (route) => serveAsset(route, failed));
  return true;
}
