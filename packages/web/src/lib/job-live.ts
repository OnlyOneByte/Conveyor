import type { JobState, JobView, PrintProgress } from "@conveyor/shared";
import { openJobSocket } from "./api";
import { duration } from "./job-settings";

export const STEPS: readonly (readonly [JobState, string])[] = [
  ["generating", "Model"],
  ["slicing", "Slice"],
  ["transferring", "Send"],
  ["printing", "Print"],
];

const WORD: Record<JobState, string> = {
  queued: "Waiting",
  generating: "Modelling",
  slicing: "Slicing",
  transferring: "Sending",
  printing: "Printing",
  done: "Printed",
  failed: "Failed",
  canceled: "Canceled",
};

export const stepIndex = (state: JobState) => STEPS.findIndex(([step]) => step === state);

type Moving = Pick<JobView, "state" | "progress">;

export const percent = ({ progress }: Moving) => Math.round((progress ?? 0) * 100);

export const measured = ({ state }: Moving) =>
  state === "slicing" || state === "transferring" || state === "printing";

export const pillText = (view: Moving) =>
  measured(view) ? `${WORD[view.state]} · ${percent(view)}%` : WORD[view.state];

export function printLine(
  print: PrintProgress | undefined,
  at: number,
  clock: (ms: number) => string,
): string {
  if (!print) return "";
  const { layer, layers, secondsLeft } = print;
  return [
    layer !== undefined && layers !== undefined ? `Layer ${layer} of ${layers}` : "",
    secondsLeft === undefined ? "" : `${duration(secondsLeft * 1000)} left`,
    secondsLeft === undefined ? "" : `done at ${clock(at + secondsLeft * 1000)}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function followJob(
  id: string,
  update: (view: JobView) => void,
  end: () => void,
): () => void {
  const socket = openJobSocket(id);
  socket.onmessage = (message) => {
    const view: JobView = JSON.parse(message.data);
    update(view);
    if (view.state === "done" || view.state === "failed" || view.state === "canceled") end();
  };
  return () => socket.close();
}
