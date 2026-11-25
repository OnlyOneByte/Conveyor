import type { JobView } from "@conveyor/shared";
import { get, writable } from "svelte/store";

export interface ActiveJobs {
  jobs: JobView[];
  ok: boolean;
}

export const activeJobs = writable<ActiveJobs | null>(null);
export const watchers = writable(0);

export const shareActive =
  (fetchJobs: () => Promise<JobView[]>) => async (): Promise<JobView[]> => {
    try {
      const jobs = await fetchJobs();
      activeJobs.set({ jobs, ok: true });
      return jobs;
    } catch (err) {
      activeJobs.update((last) => ({ jobs: last?.jobs ?? [], ok: false }));
      throw err;
    }
  };

export function watchActive(): () => void {
  watchers.update((n) => n + 1);
  return () => watchers.update((n) => n - 1);
}

export const unwatched = (covered: () => boolean) => () => covered() && get(watchers) === 0;
