import { z } from "zod";
import { ACTIVE_JOBS_KEY, type JobStatusEvent, jobChannel, jobSnapshotKey } from "./events.js";
import { isTerminal, JOB_STATES, TERMINAL_STATES } from "./job.js";

const stageSchema = z.enum(["generator", "slicer", "transport"]);

const statusEventSchema = z.object({
  jobId: z.string(),
  state: z.enum(JOB_STATES),
  at: z.number(),
  seq: z.number().optional(),
  stage: stageSchema.nullable().optional(),
  progress: z.number().optional(),
  message: z.string().optional(),
  error: z.object({ stage: stageSchema, reason: z.string() }).optional(),
  timings: z
    .array(
      z.object({
        stage: stageSchema,
        enteredAt: z.number(),
        durationMs: z.number().optional(),
      }),
    )
    .optional(),
});

export function parseStatusEvent(raw: string | null | undefined): JobStatusEvent | undefined {
  if (!raw) return undefined;
  try {
    const parsed = statusEventSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export const CANCEL_TTL_SECONDS = 7 * 24 * 60 * 60;

export function jobControlChannel(jobId: string): string {
  return `job:${jobId}:control`;
}

export function jobSeqKey(jobId: string): string {
  return `job:${jobId}:seq`;
}

export function jobCancelKey(jobId: string): string {
  return `job:${jobId}:cancel`;
}

const terminalLua = TERMINAL_STATES.map((s) => `prev.state == '${s}'`).join(" or ");

export const PUBLISH_STATUS_SCRIPT = `
local cur = redis.call('GET', KEYS[1])
if cur then
  local ok, prev = pcall(cjson.decode, cur)
  if ok and type(prev) == 'table' and (${terminalLua}) then
    return 0
  end
end
local stamped = '{"seq":' .. redis.call('INCR', KEYS[4]) .. ',' .. string.sub(ARGV[1], 2)
redis.call('SET', KEYS[1], stamped)
redis.call('PUBLISH', KEYS[2], stamped)
if ARGV[3] == '1' then
  redis.call('SREM', KEYS[3], ARGV[2])
else
  redis.call('SADD', KEYS[3], ARGV[2])
end
return 1
`;

export interface StatusScriptClient {
  eval(script: string, numKeys: number, ...args: string[]): Promise<unknown>;
}

export async function publishStatus(
  client: StatusScriptClient,
  evt: JobStatusEvent,
): Promise<boolean> {
  const written = await client.eval(
    PUBLISH_STATUS_SCRIPT,
    4,
    jobSnapshotKey(evt.jobId),
    jobChannel(evt.jobId),
    ACTIVE_JOBS_KEY,
    jobSeqKey(evt.jobId),
    JSON.stringify(evt),
    evt.jobId,
    isTerminal(evt.state) ? "1" : "0",
  );
  return written === 1;
}
