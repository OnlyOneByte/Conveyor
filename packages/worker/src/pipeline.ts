import {
  computeStageTimings,
  exhaustive,
  type GcodeArtifact,
  type JobTarget,
  type ModelArtifact,
  NOTE,
  StageError,
} from "@conveyor/shared";
import { stageDurations } from "./job-log.js";
import { type PrintOutcome, printStage, ResumeFailedError, resumePrint } from "./print.js";
import {
  checkpoint,
  createRun,
  emit,
  enterStage,
  LeaseLostError,
  messageOf,
  type PipelineDeps,
  type Run,
  type RunJobOptions,
  race,
  type TerminalState,
} from "./run.js";
import { settleCanceled, settleDone, settleError } from "./settle.js";

export type { PipelineDeps, TerminalRecord, TerminalState } from "./run.js";

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
      run.notes.push(`${NOTE.profileNotRemoved}: ${messageOf(error)}`);
    }),
  );
  const gcode = await race(run, sliced);
  run.gcodePath = gcode.path;
  await noteFilament(run, gcode.path);
  return gcode;
}

export const FILAMENT_NOT_READ = NOTE.filamentNotRead;

async function noteFilament(run: Run, gcodePath: string | undefined): Promise<void> {
  if (!gcodePath) return;
  try {
    run.filament = await run.deps.readFilament(gcodePath);
  } catch (err) {
    run.notes.push(`${FILAMENT_NOT_READ}: ${messageOf(err)}`);
  }
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

async function logSettled(run: Run, settling: Promise<TerminalState>): Promise<TerminalState> {
  const settled = (outcome: string, reason?: string) => {
    const now = Date.now();
    emit(run, {
      event: "settled",
      jobId: run.opts.jobId,
      outcome,
      stage: run.stage,
      durationMs: now - (run.enters[0]?.at ?? now),
      stages: stageDurations(computeStageTimings(run.enters, now)),
      ...(reason ? { reason } : {}),
    });
  };
  try {
    const outcome = await settling;
    settled(outcome);
    return outcome;
  } catch (err) {
    if (err instanceof LeaseLostError) settled("lease lost");
    else settled("failed", err instanceof StageError ? err.reason : messageOf(err));
    throw err;
  }
}

export function runJob(opts: RunJobOptions, deps: PipelineDeps): Promise<TerminalState> {
  const run = createRun(opts, deps);
  return logSettled(run, runFresh(run));
}

async function runFresh(run: Run): Promise<TerminalState> {
  let outcome: PrintOutcome;
  try {
    outcome = await runStages(run);
  } catch (err) {
    return settleError(run, err);
  }
  return settleOutcome(run, outcome);
}

export function resumeJob(opts: RunJobOptions, deps: PipelineDeps): Promise<TerminalState> {
  const run = createRun(opts, deps);
  return logSettled(run, runResumed(run));
}

async function runResumed(run: Run): Promise<TerminalState> {
  const { deps } = run;
  run.stage = "transport";
  run.state = "printing";
  let outcome: PrintOutcome;
  try {
    const resumed = deps.queue?.resumeState();
    if (!resumed) throw new ResumeFailedError("no stored print handle");
    run.modelPath = resumed.modelPath;
    run.gcodePath = resumed.gcodePath;
    await noteFilament(run, resumed.gcodePath);
    run.enters = (resumed.timings ?? []).map((t) => ({ stage: t.stage, at: t.enteredAt }));
    outcome = await resumePrint(run, resumed.handle);
  } catch (err) {
    return settleError(run, err);
  }
  return settleOutcome(run, outcome);
}

function settleOutcome(run: Run, outcome: PrintOutcome): Promise<TerminalState> {
  switch (outcome) {
    case "canceled":
      return settleCanceled(run, NOTE.canceledOnPrinter);
    case "done":
      return settleDone(run);
    default:
      return exhaustive(outcome);
  }
}
