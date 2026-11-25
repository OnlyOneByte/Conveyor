import type { JobView } from "@conveyor/shared";
import { writable } from "svelte/store";

interface ActiveJobs {
  jobs: JobView[];
  ok: boolean;
}

export const activeJobs = writable<ActiveJobs | null>(null);

export const shareActive =
  (fetchJobs: () => Promise<JobView[]>) =>
  async (): Promise<JobView[]> => {
    try {
      const jobs = await fetchJobs();
      activeJobs.set({ jobs, ok: true });
      return jobs;
    } catch (err) {
      activeJobs.update((last) => ({ jobs: last?.jobs ?? [], ok: false }));
      throw err;
    }
  };
