import type { JobState, JobView, PrintProgress } from "@conveyor/shared";
import { API, openJobSocket } from "./api";
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

type Moving = Pick<JobView, "state" | "progress">;

export const percent = ({ progress }: Moving) => Math.round((progress ?? 0) * 100);

export const measured = ({ state }: Moving) =>
  state === "slicing" || state === "transferring" || state === "printing";

export const pillText = (view: Moving) =>
  measured(view) ? `${WORD[view.state]} · ${percent(view)}%` : WORD[view.state];

export function printLine(
  { layer, layers, secondsLeft }: PrintProgress = {},
  at: number,
  clock: (ms: number) => string,
): string {
  return [
    layer !== undefined && layers !== undefined ? `Layer ${layer} of ${layers}` : "",
    secondsLeft === undefined ? "" : `${duration(secondsLeft * 1000)} left`,
    secondsLeft === undefined ? "" : `done at ${clock(at + secondsLeft * 1000)}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

export async function liveView(id: string, fetchFn: typeof fetch): Promise<JobView | null> {
  const r = await fetchFn(`${API}/jobs/${encodeURIComponent(id)}`).catch(() => null);
  return r?.ok ? r.json() : null;
}

export const RETRY_MS = [500, 1000, 2000, 5000, 10_000, 30_000];

export const SETTLED: JobState[] = ["done", "failed", "canceled"];

type Socket = Pick<WebSocket, "close" | "onmessage" | "onclose">;

export function followJob(
  id: string,
  update: (view: JobView) => void,
  end: () => void,
  connect: (id: string) => Socket = openJobSocket,
  snapshot = (job: string) => liveView(job, fetch),
): () => void {
  let socket: Socket | null = null;
  let stopped = false;
  let tries = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const seen = (view: JobView) => {
    update(view);
    if (SETTLED.includes(view.state)) (stopped = true), end();
  };
  const open = () => {
    const next = connect(id);
    socket = next;
    next.onmessage = (message) => ((tries = 0), seen(JSON.parse(message.data)));
    next.onclose = ({ code }) => {
      if (stopped || socket !== next) return;
      if (code === 1000 || code === 4404) return void ((stopped = true), end());
      timer = setTimeout(retry, RETRY_MS[Math.min(tries++, RETRY_MS.length - 1)]);
    };
  };
  const retry = async () => {
    const view = await snapshot(id).catch(() => null);
    if (view && !stopped) seen(view);
    if (!stopped) open();
  };
  open();
  return () => {
    stopped = true;
    clearTimeout(timer);
    socket?.close();
  };
}
