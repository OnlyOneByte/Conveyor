import type { Scene } from "./scene.ts";

interface CssRequest {
  url(): string;
  resourceType(): string;
  failure(): { errorText: string } | null;
}

interface CssResponse {
  url(): string;
  status(): number;
  request(): CssRequest;
}

export interface CssEvents {
  on(event: "requestfailed", listener: (request: CssRequest) => void): unknown;
  on(event: "response", listener: (response: CssResponse) => void): unknown;
}

const isCss = (request: CssRequest) =>
  request.resourceType() === "stylesheet" || new URL(request.url()).pathname.endsWith(".css");

const named = (url: string) => new URL(url).pathname.split("/").pop() ?? url;

export function watchCss(page: CssEvents): () => string[] {
  const problems: string[] = [];
  page.on("requestfailed", (request) => {
    if (isCss(request))
      problems.push(
        `${named(request.url())} failed: ${request.failure()?.errorText ?? "no error text"}`,
      );
  });
  page.on("response", (response) => {
    if (isCss(response.request()) && response.status() !== 200)
      problems.push(`${named(response.url())} answered HTTP ${response.status()}`);
  });
  return () => [...problems];
}

export function cssReport(problems: string[]): string {
  return problems.length === 0
    ? "CSS requests: none failed and none answered other than 200"
    : `CSS requests: ${problems.join("; ")}`;
}

export function needsServiceWorker(scene: Scene): boolean {
  return (scene.steps ?? []).some(
    (step) => typeof step === "object" && "offline" in step && step.only !== "editor",
  );
}

export async function noteNetwork(
  error: string,
  css: string[],
  caddy?: { logs: () => string; since: number; path: string },
): Promise<string> {
  const noted = `${error}. ${cssReport(css)}`;
  if (!caddy) return noted;
  const lines = caddyErrors(caddy.logs(), caddy.since);
  await Bun.write(caddy.path, lines.length ? `${lines.join("\n")}\n` : "");
  const file = caddy.path.split("/").pop();
  return `${noted}. Caddy logged ${lines.length} error line(s) during the shot (${file})`;
}

export function caddyErrors(logs: string, since: number): string[] {
  return logs.split("\n").filter((line) => {
    if (!line.includes('"level":"error"')) return false;
    const ts = Number(line.match(/"ts":([0-9.]+)/)?.[1] ?? Number.NaN);
    return !(ts * 1000 < since);
  });
}
