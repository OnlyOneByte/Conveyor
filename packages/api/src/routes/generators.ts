import type { FastifyInstance } from "fastify";
import { apiRegistry } from "../registry-view.js";

export async function registerGeneratorRoutes(app: FastifyInstance): Promise<void> {
  app.get("/generators", async () => {
    return [...apiRegistry.generators.values()].map((g) => ({
      id: g.id,
      name: g.name,
      paramSchema: g.paramSchema,
      ui: g.ui,
      preview: g.preview,
      outputs: g.outputs,
    }));
  });
}
