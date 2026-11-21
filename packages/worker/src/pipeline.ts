import {
  type GcodeArtifact,
  type JobTarget,
  type ModelArtifact,
  StageError,
} from "@conveyor/shared";
import { printStage } from "./print.js";
import {
  checkpoint,
  createRun,
  enterStage,
  messageOf,
  type PipelineDeps,
  type Run,
  type RunJobOptions,
  race,
  type TerminalState,
} from "./run.js";
import { settleCanceled, settleDone, settleError } from "./settle.js";

export type {
  PipelineDeps,
  PublishExtra,
  RunJobOptions,
  TerminalRecord,
  TerminalState,
} from "./run.js";
export { JobCanceledError } from "./run.js";

async function generateStage(run: Run): Promise<ModelArtifact> {
  await enterStage(run, "generator", "generating");
  const { req } = run.opts;
  const generator = run.deps.registry.generators.get(req.generator.id);
  if (!generator) throw new StageError("generator", `unknown generator ${req.generator.id}`);
  const model = await race(run, generator.generate(req.generator.params, run.ctx));
  run.modelPath = model.path;
  return model;
}

async function sliceStage(
  run: Run,
  target: JobTarget,
  model: ModelArtifact,
): Promise<GcodeArtifact> {
  await enterStage(run, "slicer", "slicing");
  const slicer = run.deps.registry.slicers.get(target.slicerId);
  if (!slicer) throw new StageError("slicer", `unknown slicer ${target.slicerId}`);
  const profile = await run.deps.resolveProfile(target, run.opts.workDir);
  run.ctx.log(`profile ${target.profileId}: ${profile.source}`);
  const sliced = slicer
    .slice(model, profile.profile, run.ctx)
    .finally(() =>
      profile
        .cleanup()
        .catch((error) =>
          run.ctx.log(`warning: failed to clean materialized profile: ${messageOf(error)}`),
        ),
    );
  const gcode = await race(run, sliced);
  run.gcodePath = gcode.path;
  return gcode;
}

export async function runJob(opts: RunJobOptions, deps: PipelineDeps): Promise<TerminalState> {
  const run = createRun(opts, deps);
  try {
    await checkpoint(run);
    const target = deps.resolveJobTarget(opts.req);
    if (!target) {
      throw new StageError(
        "generator",
        `unknown printer ${opts.req.printerId} or profile ${opts.req.profileId}`,
      );
    }
    const model = await generateStage(run);
    const gcode = await sliceStage(run, target, model);
    const outcome = await printStage(run, target, gcode);
    if (outcome === "canceled") return await settleCanceled(run, "canceled on printer");
    return await settleDone(run);
  } catch (err) {
    return settleError(run, err);
  }
}
