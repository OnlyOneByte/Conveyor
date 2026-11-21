import {
  exhaustive,
  type GcodeArtifact,
  type JobTarget,
  type ModelArtifact,
  StageError,
} from "@conveyor/shared";
import { type PrintOutcome, printStage, ResumeFailedError, resumePrint } from "./print.js";
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
  const sliced = slicer.slice(model, profile.profile, run.ctx).finally(() =>
    profile.cleanup().catch((error: unknown) => {
      run.notes.push(`materialized profile not removed: ${messageOf(error)}`);
    }),
  );
  const gcode = await race(run, sliced);
  run.gcodePath = gcode.path;
  return gcode;
}

async function runStages(run: Run): Promise<PrintOutcome> {
  await checkpoint(run);
  const { req } = run.opts;
  const target = run.deps.resolveJobTarget(req);
  if (!target) {
    throw new StageError(
      "generator",
      `unknown printer ${req.printerId} or profile ${req.profileId}`,
    );
  }
  const model = await generateStage(run);
  const gcode = await sliceStage(run, target, model);
  return printStage(run, target, gcode);
}

export async function runJob(opts: RunJobOptions, deps: PipelineDeps): Promise<TerminalState> {
  const run = createRun(opts, deps);
  let outcome: PrintOutcome;
  try {
    outcome = await runStages(run);
  } catch (err) {
    return settleError(run, err);
  }
  return settleOutcome(run, outcome);
}

export async function resumeJob(opts: RunJobOptions, deps: PipelineDeps): Promise<TerminalState> {
  const run = createRun(opts, deps);
  run.stage = "transport";
  run.state = "printing";
  let outcome: PrintOutcome;
  try {
    const handle = deps.queue?.printHandle();
    if (!handle) throw new ResumeFailedError("no stored print handle");
    outcome = await resumePrint(run, handle);
  } catch (err) {
    return settleError(run, err);
  }
  return settleOutcome(run, outcome);
}

function settleOutcome(run: Run, outcome: PrintOutcome): Promise<TerminalState> {
  switch (outcome) {
    case "canceled":
      return settleCanceled(run, "canceled on printer");
    case "done":
      return settleDone(run);
    default:
      return exhaustive(outcome);
  }
}
