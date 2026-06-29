// M0 placeholder server. M3 replaces this whole package with a SvelteKit
// (adapter-node) PWA + Threlte procedural preview. For now it serves a static
// landing page so the compose topology + Caddy routing can be verified.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);

createServer(async (_req, res) => {
  try {
    const html = await readFile(join(root, "public", "index.html"));
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
  } catch {
    res.writeHead(500);
    res.end("web stub error");
  }
}).listen(PORT, "0.0.0.0", () => console.log(`conveyor web stub on :${PORT}`));
