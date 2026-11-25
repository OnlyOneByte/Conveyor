import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright";

const writes = new WeakMap<Page, string[]>();

export function editorChunks(root: string): string[] {
  const file = join(root, "packages/web/.svelte-kit/output/editor-chunks.json");
  const listed: unknown = JSON.parse(readFileSync(file, "utf8"));
  const chunks = Array.isArray(listed)
    ? listed.filter((c): c is string => typeof c === "string")
    : [];
  if (chunks.length === 0) throw new Error(`${file} lists no editor chunk; has the build changed?`);
  return chunks;
}

export function recordWrites(page: Page): void {
  if (writes.has(page)) return;
  const sent: string[] = [];
  writes.set(page, sent);
  page.on("request", (request) => {
    const { pathname } = new URL(request.url());
    if (request.method() !== "GET" && pathname.startsWith("/api/"))
      sent.push(`${request.method()} ${pathname}`);
  });
}

export async function blockEditor(page: Page, root: string): Promise<void> {
  for (const chunk of editorChunks(root))
    await page.route(`**/${chunk}`, (route) => route.abort("internetdisconnected"));
}

export function sentSince(page: Page): string[] {
  const sent = writes.get(page);
  if (!sent) throw new Error("no offline step ran before this one, so no writes were recorded");
  return sent;
}
