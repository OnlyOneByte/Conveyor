import { type PrintProgress, StageError } from "@conveyor/shared";
import { z } from "zod";

const count = z.number().int().nonnegative().nullable().optional().catch(undefined);
const fraction = z.number().finite().optional();

const QueryReply = z.object({
  result: z
    .object({
      status: z
        .object({
          print_stats: z
            .object({
              state: z.string().optional(),
              message: z.string().optional(),
              filename: z.string().optional().catch(undefined),
              print_duration: z.number().optional().catch(undefined),
              info: z
                .object({ current_layer: count, total_layer: count })
                .nullable()
                .optional()
                .catch(undefined),
            })
            .optional(),
          virtual_sdcard: z.object({ progress: fraction }).optional(),
          display_status: z.object({ progress: fraction }).optional(),
        })
        .optional(),
    })
    .optional(),
});

type PrinterObjects = NonNullable<NonNullable<z.infer<typeof QueryReply>["result"]>["status"]>;

export function parseQuery(json: unknown): PrinterObjects {
  const parsed = QueryReply.safeParse(json);
  if (!parsed.success)
    throw new StageError(
      "transport",
      `moonraker status: unexpected reply: ${parsed.error.message}`,
    );
  return parsed.data.result?.status ?? {};
}

const MIN_PROGRESS_FOR_ESTIMATE = 0.01;
const MIN_ELAPSED_SECONDS = 1;

function secondsLeftOf(elapsed: number | undefined, fileProgress: number | undefined) {
  if (elapsed === undefined || elapsed < MIN_ELAPSED_SECONDS || fileProgress === undefined)
    return undefined;
  if (fileProgress < MIN_PROGRESS_FOR_ESTIMATE || fileProgress >= 1) return undefined;
  return Math.round((elapsed * (1 - fileProgress)) / fileProgress);
}

export function printProgressOf(objects: PrinterObjects): PrintProgress | undefined {
  const info = objects.print_stats?.info;
  const print: PrintProgress = {};
  if (typeof info?.current_layer === "number") print.layer = info.current_layer;
  if (typeof info?.total_layer === "number" && info.total_layer > 0)
    print.layers = info.total_layer;
  const secondsLeft = secondsLeftOf(
    objects.print_stats?.print_duration,
    objects.virtual_sdcard?.progress,
  );
  if (secondsLeft !== undefined) print.secondsLeft = secondsLeft;
  return Object.keys(print).length > 0 ? print : undefined;
}
