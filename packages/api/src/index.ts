import Fastify from "fastify";
import websocket from "@fastify/websocket";
import multipart from "@fastify/multipart";
import { registerJobRoutes } from "./routes/jobs.js";
import { registerStationRoutes } from "./routes/stations.js";
import { registerGeneratorRoutes } from "./routes/generators.js";
import { registerUploadRoutes } from "./routes/uploads.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { registerAuthRoutes, registerAuthGuard } from "./routes/auth.js";

const PORT = Number(process.env.PORT ?? 3000);
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES ?? 100 * 1024 * 1024);

const app = Fastify({ logger: true });
await app.register(websocket);
await app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES } });

app.get("/health", async () => ({ ok: true }));

// Auth gate first (onRequest hook), then the login routes it allows through.
registerAuthGuard(app);
await registerAuthRoutes(app);

await registerStationRoutes(app);
await registerGeneratorRoutes(app);
await registerUploadRoutes(app);
await registerAdminRoutes(app);
await registerJobRoutes(app);

await app.listen({ host: "0.0.0.0", port: PORT });
app.log.info(`conveyor api listening on :${PORT}`);
