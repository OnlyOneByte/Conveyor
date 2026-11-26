export class UploadTimeout extends Error {}

export type Timers = (run: () => void, ms: number) => () => void;

export const realTimers: Timers = (run, ms) => {
  const handle = setTimeout(run, ms);
  return () => clearTimeout(handle);
};

export interface UploadTimer {
  expired: Promise<never>;
  touch(): void;
  onExpire(abort: (error: UploadTimeout) => void): void;
  clear(): void;
}

export function uploadTimer(
  limits: { idleMs: number; deadlineMs: number },
  timers: Timers = realTimers,
): UploadTimer {
  let fail: (error: UploadTimeout) => void = () => undefined;
  const expired = new Promise<never>((_, reject) => {
    fail = reject;
  });
  expired.catch(() => undefined);
  const aborts: ((error: UploadTimeout) => void)[] = [];
  let cancelIdle: () => void = () => undefined;
  let done = false;
  const clear = () => {
    done = true;
    cancelIdle();
    cancelTotal();
  };
  const expire = (why: string) => {
    if (done) return;
    clear();
    const error = new UploadTimeout(why);
    fail(error);
    for (const abort of aborts) abort(error);
  };
  const cancelTotal = timers(
    () => expire(`the upload took longer than ${limits.deadlineMs} ms`),
    limits.deadlineMs,
  );
  const touch = () => {
    if (done) return;
    cancelIdle();
    cancelIdle = timers(() => expire(`no bytes arrived for ${limits.idleMs} ms`), limits.idleMs);
  };
  touch();
  return { expired, touch, onExpire: (abort) => aborts.push(abort), clear };
}
