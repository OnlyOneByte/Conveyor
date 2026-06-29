import type { FastifyInstance } from "fastify";
import { listStations } from "../stations-store.js";

export async function registerStationRoutes(app: FastifyInstance): Promise<void> {
  // End users pick from this list; slicer/profile/printer detail stays server-side.
  app.get("/stations", async () => {
    const stations = await listStations();
    return stations.map((s) => ({ id: s.id, name: s.name, allowedGenerators: s.allowedGenerators }));
  });
}
