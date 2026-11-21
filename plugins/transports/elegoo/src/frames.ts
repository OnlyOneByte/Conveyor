import { z } from "zod";

export type Decoded<T> = { kind: "decoded"; value: T } | { kind: "malformed"; reason: string };

type Schema<T> = z.ZodType<T, z.ZodTypeDef, unknown>;

function quote(raw: string): string {
  return JSON.stringify(raw.slice(0, 80));
}

function decodeJson(raw: string): Decoded<unknown> {
  try {
    return { kind: "decoded", value: JSON.parse(raw) };
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    return { kind: "malformed", reason: `${why} in ${quote(raw)}` };
  }
}

export function decodeShape<T>(schema: Schema<T>, value: unknown, raw: string): Decoded<T> {
  const parsed = schema.safeParse(value);
  if (parsed.success) return { kind: "decoded", value: parsed.data };
  const issues = parsed.error.issues
    .map((issue) => `${issue.path.join(".") || "frame"}: ${issue.message}`)
    .join(", ");
  return { kind: "malformed", reason: `${issues} in ${quote(raw)}` };
}

export function decodeFrame<T>(schema: Schema<T>, raw: string): Decoded<T> {
  const json = decodeJson(raw);
  if (json.kind === "malformed") return json;
  return decodeShape(schema, json.value, raw);
}

const text = z.string().optional();
const count = z.number().optional();

const DiscoveryFields = z.object({
  Name: text,
  name: text,
  MachineName: text,
  machineName: text,
  BrandName: text,
  brandName: text,
  MainboardIP: text,
  mainboardIP: text,
  MainboardID: text,
  mainboardID: text,
  ProtocolVersion: text,
  FirmwareVersion: text,
});

export const DiscoveryReply = z.object({
  Data: DiscoveryFields.optional(),
  data: DiscoveryFields.optional(),
});

export const PushEnvelope = z.object({
  Topic: z.string().default(""),
  Data: z.unknown(),
});

export const StatusData = z
  .object({
    Status: z
      .object({
        CurrentStatus: z.union([z.array(z.number()), z.number()]).optional(),
        PrintInfo: z
          .object({ Status: count, Progress: count, CurrentLayer: count, TotalLayer: count })
          .default({}),
      })
      .default({}),
  })
  .default({});

export const ErrorData = z.object({ Data: z.object({ ErrorCode: z.number() }) });

const AckFields = z.object({ RequestID: text, Ack: count });

export const AckFrame = z.object({
  Data: AckFields.extend({ Data: AckFields.optional() }).optional(),
});
