import multipart from "@fastify/multipart";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import { registerAuthGuard, registerAuthRoutes } from "./routes/auth.js";
import { registerCatalogRoutes } from "./routes/catalog.js";
import { registerGeneratorRoutes } from "./routes/generators.js";
import { registerJobRoutes } from "./routes/jobs.js";
import { registerUploadRoutes } from "./routes/uploads.js";

const PORT = Number(process.env.PORT ?? 3000);
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES ?? 100 * 1024 * 1024);

const app = Fastify({ logger: true });
await app.register(websocket);
await app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES } });

app.get("/health", async () => ({ ok: true }));

// Auth gate first (onRequest hook), then the login routes it allows through.
registerAuthGuard(app);
await registerAuthRoutes(app);

await registerGeneratorRoutes(app);
await registerUploadRoutes(app);
await registerCatalogRoutes(app);
await registerJobRoutes(app);

await app.listen({ host: "0.0.0.0", port: PORT });
app.log.info(`conveyor api listening on :${PORT}`);
