import { dbGetPrinter, openDb } from "@conveyor/shared/db";
import { releasePrinterHold } from "@conveyor/shared/queue";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

const releaseSchema = z.object({ confirm: z.literal(true) }).strict();

export async function registerPrinterHoldRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { id: string } }>("/catalog/printers/:id/release", async (req, reply) => {
    if (!releaseSchema.safeParse(req.body).success) {
      return reply
        .code(400)
        .send({ error: 'check the printer, then send {"confirm": true} to release its hold' });
    }
    const db = openDb();
    if (!dbGetPrinter(db, req.params.id)) {
      return reply.code(404).send({ error: `unknown printer ${req.params.id}` });
    }
    if (!releasePrinterHold(db, req.params.id)) {
      return reply.code(409).send({ error: `printer ${req.params.id} has no hold` });
    }
    return reply.send({ ok: true, printerId: req.params.id });
  });
}
