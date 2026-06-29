import type { FastifyInstance } from "fastify";
import { apiRegistry } from "../registry-view.js";

// Exposes each generator's UI-facing metadata so the PWA can render its config
// form (paramSchema) and pick a client preview module. No engine code runs here —
// generate() is never called in the api process (ADR 0001).
export async function registerGeneratorRoutes(app: FastifyInstance): Promise<void> {
  app.get("/generators", async () => {
    return [...apiRegistry.generators.values()].map((g) => ({
      id: g.id,
      name: g.name,
      paramSchema: g.paramSchema,
      preview: g.preview,
      outputs: g.outputs,
    }));
  });
}
