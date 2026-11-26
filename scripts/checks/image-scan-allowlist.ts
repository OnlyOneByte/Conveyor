export const ALLOWLIST = ".github/image-scan-allowlist.yaml";
export const MAX_DAYS = 180;

const ID = /^(CVE-\d{4}-\d+|GHSA(-[23456789cfghjmpqrvwx]{4}){3})$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function expiryErrors(where: string, expiry: unknown, today: Date): string[] {
  const text = expiry instanceof Date ? expiry.toISOString().slice(0, 10) : String(expiry ?? "");
  if (!DATE.test(text) || Number.isNaN(Date.parse(text)))
    return [`${where}: expired_at must be a YYYY-MM-DD date`];
  const days = (Date.parse(text) - today.getTime()) / DAY_MS;
  return days > MAX_DAYS ? [`${where}: expired_at ${text} is more than ${MAX_DAYS} days away`] : [];
}

function entryErrors(entry: unknown, index: number, today: Date): string[] {
  const where = `vulnerabilities[${index}]`;
  if (!isRecord(entry)) return [`${where} isn't a mapping`];
  const errors: string[] = [];
  if (typeof entry.id !== "string" || !ID.test(entry.id))
    errors.push(`${where}: id must be a CVE or GHSA id`);
  if (typeof entry.statement !== "string" || entry.statement.trim().length < 20)
    errors.push(`${where}: statement must give the reason it's accepted, in 20 characters or more`);
  return [...errors, ...expiryErrors(where, entry.expired_at, today)];
}

export function allowlistErrors(text: string, today: Date): string[] {
  const parsed: unknown = Bun.YAML.parse(text);
  if (!isRecord(parsed) || !Array.isArray(parsed.vulnerabilities))
    return [`${ALLOWLIST} must hold a vulnerabilities list`];
  const extra = Object.keys(parsed).filter((key) => key !== "vulnerabilities");
  const errors = extra.map((key) => `${ALLOWLIST} accepts only vulnerabilities, not ${key}`);
  return [...errors, ...parsed.vulnerabilities.flatMap((entry, i) => entryErrors(entry, i, today))];
}
