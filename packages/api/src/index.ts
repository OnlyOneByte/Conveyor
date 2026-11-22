import { queueMode } from "@conveyor/shared";
import multipart from "@fastify/multipart";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import { registerAuthGuard, registerAuthRoutes } from "./routes/auth.js";
import { registerCatalogRoutes } from "./routes/catalog.js";
import { registerGeneratorRoutes } from "./routes/generators.js";
import { registerPrinterHoldRoutes } from "./routes/printer-holds.js";
import { registerUploadRoutes } from "./routes/uploads.js";
import { parseTrustedProxies } from "./trusted-proxies.js";

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.CONVEYOR_HOST ?? "127.0.0.1";
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES ?? 100 * 1024 * 1024);

let queue: string;
let trustProxy: string[] | false;
try {
  queue = queueMode(process.env);
  trustProxy = parseTrustedProxies(process.env.CONVEYOR_TRUSTED_PROXIES);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

const app = Fastify({ logger: true, trustProxy });
await app.register(websocket);
await app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES } });

app.get("/health", async () => ({ ok: true }));

registerAuthGuard(app);
await registerAuthRoutes(app);

await registerGeneratorRoutes(app);
await registerUploadRoutes(app);
await registerCatalogRoutes(app);
await registerPrinterHoldRoutes(app);
const { registerJobRoutes } = await import(
  queue === "sqlite" ? "./routes/jobs-sqlite.js" : "./routes/jobs.js"
);
await registerJobRoutes(app);
app.log.info(`conveyor api queue: ${queue}`);

await app.listen({ host: HOST, port: PORT });
app.log.info(`conveyor api listening on :${PORT}`);
