import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { registerJobRoutes } from "./routes/jobs.js";
import { registerStationRoutes } from "./routes/stations.js";

const PORT = Number(process.env.PORT ?? 3000);

const app = Fastify({ logger: true });
await app.register(websocket);

app.get("/health", async () => ({ ok: true }));

await registerStationRoutes(app);
await registerJobRoutes(app);

await app.listen({ host: "0.0.0.0", port: PORT });
app.log.info(`conveyor api listening on :${PORT}`);
