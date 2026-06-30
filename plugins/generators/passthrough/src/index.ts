import { copyFile, stat } from "node:fs/promises";
import { join, basename } from "node:path";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  StageError,
  type GeneratorPlugin,
  type JSONSchema7,
  type ModelArtifact,
  type StageCtx,
} from "@conveyor/shared";
import { passthroughParams, type PassthroughParams } from "./params.js";

/**
 * Passthrough generator: the user's uploaded STL IS the model. No engine, no
 * geometry synthesis — it just hands the uploaded file to the slicer stage.
 * This is the "Upload STL" source (SPEC §8 non-goal promoted to v1).
 *
 * The API stores upload bytes under <DATA_DIR>/uploads/<uploadId>.stl; the
 * worker shares that same /data volume, so generate() copies the upload into
 * the job workdir (keeping the pipeline's "artifacts live in workDir" invariant
 * and leaving the original upload intact for retries).
 */
const DATA_DIR = process.env.DATA_DIR ?? "/data";
const UPLOAD_DIR = process.env.UPLOAD_DIR ?? join(DATA_DIR, "uploads");

export const passthrough: GeneratorPlugin<PassthroughParams> = {
  id: "passthrough",
  name: "Upload STL",
  version: "0.1.0",
  stage: "generator",
  outputs: ["stl"],
  paramSchema: zodToJsonSchema(passthroughParams, "PassthroughParams") as JSONSchema7,
  // No procedural preview: the client renders the real uploaded mesh (STLLoader).

  async generate(rawParams, ctx: StageCtx): Promise<ModelArtifact> {
    const parsed = passthroughParams.safeParse(rawParams);
    if (!parsed.success) throw new StageError("generator", `invalid params: ${parsed.error.message}`);

    // basename() is a defense-in-depth backstop on top of the slug regex — the
    // joined path can never resolve outside UPLOAD_DIR.
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
