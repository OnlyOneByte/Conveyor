import { HISTORY_STATES } from "@conveyor/shared/db";
import { z } from "zod";

export const DEFAULT_HISTORY_LIMIT = 50;
export const MAX_HISTORY_LIMIT = 200;

const epochMs = z
  .string()
  .regex(/^\d{1,15}$/, "must be epoch milliseconds")
  .transform(Number);

const CURSOR = /^(\d{1,15}):(.+)$/;

const cursor = z
  .string()
  .max(300)
  .transform((text, ctx) => {
    const match = CURSOR.exec(text);
    if (!match?.[1] || !match[2]) {
      ctx.addIssue({ code: "custom", message: "must be <updatedAt>:<id>" });
      return z.NEVER;
    }
    return { updatedAt: Number(match[1]), id: match[2] };
  });

export const historyCountQuery = z.object({
  printerId: z.string().min(1).max(128).optional(),
  since: epochMs.optional(),
  until: epochMs.optional(),
});

export const historyPageQuery = historyCountQuery.extend({
  limit: z
    .string()
    .optional()
    .transform((text) => {
      const limit = Number(text);
      return Number.isInteger(limit) && limit > 0
        ? Math.min(limit, MAX_HISTORY_LIMIT)
        : DEFAULT_HISTORY_LIMIT;
    }),
  state: z.enum(HISTORY_STATES).optional(),
  before: cursor.optional(),
});
