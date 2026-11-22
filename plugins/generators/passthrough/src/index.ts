import { copyFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  type GeneratorPlugin,
  type JSONSchema7,
  type ModelArtifact,
  type StageCtx,
  StageError,
} from "@conveyor/shared";
import { zodToJsonSchema } from "zod-to-json-schema";
import { type PassthroughParams, passthroughParams } from "./params.js";
import { checkUpload, uploadRules } from "./upload.js";

const DATA_DIR = process.env.DATA_DIR ?? "/data";
const UPLOAD_DIR = process.env.UPLOAD_DIR ?? join(DATA_DIR, "uploads");

export const passthrough: GeneratorPlugin<PassthroughParams> = {
  id: "passthrough",
  name: "Upload STL",
  version: "0.1.0",
  stage: "generator",
  outputs: ["stl"],
  params: passthroughParams,
  paramSchema: zodToJsonSchema(passthroughParams, "PassthroughParams") as JSONSchema7,
  validateRequest: (params) => checkUpload(params.uploadId, uploadRules(process.env)),

  async generate(rawParams, ctx: StageCtx): Promise<ModelArtifact> {
    const parsed = passthroughParams.safeParse(rawParams);
    if (!parsed.success)
      throw new StageError("generator", `invalid params: ${parsed.error.message}`);

    const src = join(UPLOAD_DIR, `${basename(parsed.data.uploadId)}.stl`);
    try {
      await stat(src);
    } catch {
      throw new StageError("generator", `upload not found: ${parsed.data.uploadId}`);
    }

    const out = join(ctx.workDir, "model.stl");
    ctx.log(`passthrough: copy upload ${parsed.data.uploadId} → ${out}`);
    await copyFile(src, out);
    return {
      path: out,
      format: "stl",
      meta: { uploadId: parsed.data.uploadId, filename: parsed.data.filename },
    };
  },
};
