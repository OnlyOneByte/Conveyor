import type { FastifyInstance } from "fastify";
import { listStations, profilesById } from "../stations-store.js";
import { toStationSummary } from "../station-summary.js";

export async function registerStationRoutes(app: FastifyInstance): Promise<void> {
  // End users pick from this list. Slicer/profile/printer wiring stays server-side,
  // but the summary now exposes the structured fields the picker needs for real
  // chips (flavor/material/quality), derived from each station's bound profile.
  app.get("/stations", async () => {
    const [stations, profiles] = await Promise.all([listStations(), profilesById()]);
    return stations.map((s) => toStationSummary(s, profiles.get(s.profileId)));
  });
}
