export function workerConcurrency(env: Record<string, string | undefined>): number {
  const raw = env.WORKER_CONCURRENCY;
  if (raw === undefined || raw === "") return 2;
  if (!/^[1-9][0-9]*$/.test(raw)) {
    throw new Error(`WORKER_CONCURRENCY must be a positive integer, got ${raw}`);
  }
  return Number(raw);
}
