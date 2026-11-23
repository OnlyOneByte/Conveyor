import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { paramJsonSchema } from "./param-schema.js";

describe("paramJsonSchema", () => {
  test("wraps the object in the $ref and definitions envelope the web form resolves", () => {
    const schema = z
      .object({
        size: z.number().int().min(1).max(5).default(2).describe("Size"),
        name: z.string(),
      })
      .strict();
    expect(paramJsonSchema(schema, "Params")).toEqual({
      $ref: "#/definitions/Params",
      definitions: {
        Params: {
          type: "object",
          properties: {
            size: { type: "integer", minimum: 1, maximum: 5, default: 2, description: "Size" },
            name: { type: "string" },
          },
          required: ["name"],
          additionalProperties: false,
        },
      },
      $schema: "http://json-schema.org/draft-07/schema#",
    });
  });
});
