import { queueMode } from "@conveyor/shared";
import { dbListPrinters, openDb } from "@conveyor/shared/db";
import { allowList, loopbackPrinters } from "@conveyor/shared/node";
import { type UploadSettings, uploadSettings } from "@conveyor/shared/uploads";
import multipart from "@fastify/multipart";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import { registerErrorReplies } from "./error-replies.js";
import { PUBLIC_ROUTE, registerAuthGuard, registerAuthRoutes } from "./routes/auth.js";
import { registerCatalogRoutes } from "./routes/catalog.js";
import { registerGeneratorRoutes } from "./routes/generators.js";
import { registerPrinterHoldRoutes } from "./routes/printer-holds.js";
import { registerUploadRoutes } from "./routes/uploads.js";
import { frameworkErrors, registerSecurityHeaders } from "./security-headers.js";
import { closeOnSignals, closeSocketsRestarting } from "./shutdown.js";
import { parseTrustedProxies } from "./trusted-proxies.js";

const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.CONVEYOR_HOST ?? "127.0.0.1";

let queue: string;
let trustProxy: string[] | false;
let uploads: UploadSettings;
try {
  uploads = uploadSettings(process.env);
  queue = queueMode(process.env);
  trustProxy = parseTrustedProxies(process.env.CONVEYOR_TRUSTED_PROXIES);
  allowList(process.env);
  openDb();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

const app = Fastify({ logger: true, trustProxy, frameworkErrors });
await app.register(websocket, { preClose: closeSocketsRestarting });
closeOnSignals(app, { source: process, exit: (code) => process.exit(code) });
await app.register(multipart, { limits: { fileSize: uploads.maxBytes } });
registerSecurityHeaders(app);
registerErrorReplies(app);

app.get("/health", PUBLIC_ROUTE, async () => ({ ok: true }));

registerAuthGuard(app);
await registerAuthRoutes(app);

await registerGeneratorRoutes(app);
await registerUploadRoutes(app, uploads);
const { registerJobRoutes, countLiveJobs } = await import(
  queue === "sqlite" ? "./routes/jobs-sqlite.js" : "./routes/jobs.js"
);
await registerCatalogRoutes(app, countLiveJobs);
await registerPrinterHoldRoutes(app);
await registerJobRoutes(app);
app.log.info(`conveyor api queue: ${queue}`);
const onLoopback = loopbackPrinters(dbListPrinters(openDb()));
if (onLoopback.length)
  app.log.info(`printers on this host's loopback address: ${onLoopback.join(", ")}`);

await app.listen({ host: HOST, port: PORT });
app.log.info(`conveyor api listening on :${PORT}`);
