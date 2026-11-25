import { join } from "node:path";
import type { Page } from "playwright";

export interface StepKinds {
  wait: { wait: number };
}

export type Step = StepKinds[keyof StepKinds];

export interface StepContext {
  root: string;
}

export interface StepRunner {
  kind: keyof StepKinds;
  run(page: Page, step: Step, warnings: string[], context: StepContext): Promise<unknown>;
}

export const wrongKind = (kind: string, step: Step) =>
  new Error(`the ${kind} runner got ${JSON.stringify(Object.keys(step))}`);

const isRunner = (value: unknown): value is StepRunner =>
  typeof value === "object" && value !== null && "kind" in value && "run" in value;

async function loadRunners(): Promise<Map<string, StepRunner>> {
  const dir = join(import.meta.dir, "steps");
  const files = (await Array.fromAsync(new Bun.Glob("*.ts").scan({ cwd: dir })))
    .filter((file) => !file.endsWith(".test.ts"))
    .sort();
  const runners = new Map<string, StepRunner>();
  for (const file of files) {
    const { step } = await import(join(dir, file));
    if (!isRunner(step)) throw new Error(`steps/${file} exports no \`step\` runner`);
    if (runners.has(step.kind)) throw new Error(`steps/${file}: a second ${step.kind} runner`);
    runners.set(step.kind, step);
  }
  return runners;
}

export const runners = await loadRunners();

export function runnerFor(step: Step): StepRunner {
  const kinds = Object.keys(step).filter((key) => runners.has(key));
  const runner = kinds.length === 1 && kinds[0] ? runners.get(kinds[0]) : undefined;
  if (!runner) throw new Error(`no single step runner for ${JSON.stringify(Object.keys(step))}`);
  return runner;
}

export const runStep = (page: Page, step: Step, warnings: string[], context: StepContext) =>
  runnerFor(step).run(page, step, warnings, context);
