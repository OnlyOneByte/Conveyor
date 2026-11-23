import type { JSONSchema7 } from "json-schema";
import { type ZodType, z } from "zod";

export function paramJsonSchema(schema: ZodType, name: string): JSONSchema7 {
  const { $schema, ...definition } = z.toJSONSchema(schema, { target: "draft-7", io: "input" });
  return {
    $ref: `#/definitions/${name}`,
    definitions: { [name]: definition as JSONSchema7 },
    $schema,
  };
}
