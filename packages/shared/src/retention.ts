export const RETENTION_SETTING = "CONVEYOR_RETENTION_DAYS";
export const DEFAULT_RETENTION_DAYS = 30;
export const DAY_MS = 24 * 60 * 60 * 1000;

export function retentionDays(env: Record<string, string | undefined>): number {
  const raw = env[RETENTION_SETTING];
  if (raw === undefined || raw.trim() === "") return DEFAULT_RETENTION_DAYS;
  if (!/^\d+$/.test(raw.trim()))
    throw new Error(
      `${RETENTION_SETTING} must be a whole number of days (0 turns it off), got ${raw}`,
    );
  return Number(raw.trim());
}
