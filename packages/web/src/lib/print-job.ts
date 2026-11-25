import { get, writable } from "svelte/store";
import { announce } from "./announce.js";
import { jobSent } from "./belt.js";
import { AlreadyRetried, sendJob } from "./rerun.js";
import { detailOf, said } from "./said.js";

export const SENT_MS = 2500;

export interface PrintState {
  busy: boolean;
  sent: boolean;
  last: { id: string; printer: string } | null;
  error: string | null;
  retried: string | null;
  why: string | null;
  attempt: number;
}

type Send = typeof sendJob;

export function printJob(go: (to: string) => Promise<unknown>, send: Send = sendJob) {
  const state = writable<PrintState>({
    busy: false,
    sent: false,
    last: null,
    error: null,
    retried: null,
    why: null,
    attempt: 0,
  });
  const patch = (next: Partial<PrintState>) => state.update((s) => ({ ...s, ...next }));

  async function run(
    request: Parameters<Send>[0],
    retryOf: Parameters<Send>[1],
    label: string,
    printer: string,
  ) {
    if (get(state).busy) return false;
    patch({ busy: true });
    try {
      const { jobId } = await send(request, retryOf);
      await go(`/?job=${encodeURIComponent(jobId)}`);
      announce(`${label} sent to ${printer}.`);
      jobSent();
      patch({ error: null, retried: null, last: { id: jobId, printer }, sent: true });
      setTimeout(() => patch({ sent: false }), SENT_MS);
    } catch (e) {
      const retried = e instanceof AlreadyRetried ? e.retriedBy : null;
      patch({ error: said(e), why: detailOf(e), attempt: get(state).attempt + 1, retried });
    } finally {
      patch({ busy: false });
    }
    return true;
  }

  return { subscribe: state.subscribe, run };
}
