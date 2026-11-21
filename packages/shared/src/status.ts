import { ACTIVE_JOBS_KEY, type JobStatusEvent, jobChannel, jobSnapshotKey } from "./events.js";
import { isTerminal, TERMINAL_STATES } from "./job.js";

export const CANCEL_TTL_SECONDS = 7 * 24 * 60 * 60;

export function jobControlChannel(jobId: string): string {
  return `job:${jobId}:control`;
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
redis.call('SET', KEYS[1], ARGV[1])
redis.call('PUBLISH', KEYS[2], ARGV[1])
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
    3,
    jobSnapshotKey(evt.jobId),
    jobChannel(evt.jobId),
    ACTIVE_JOBS_KEY,
    JSON.stringify(evt),
    evt.jobId,
    isTerminal(evt.state) ? "1" : "0",
  );
  return written === 1;
}
