import { JOB_QUEUE, type JobRequest } from "@conveyor/shared";
import { Queue } from "bullmq";
import { Redis } from "ioredis";

const REDIS_URL = process.env.REDIS_URL ?? "redis://redis:6379";

export const QUEUE_DEADLINE_MS = 2_000;

export const SOCKET_TIMEOUT_MS = 3_000;

export const FAIL_FAST = {
  enableOfflineQueue: false,
  autoResendUnfulfilledCommands: false,
  maxRetriesPerRequest: 0,
  socketTimeout: SOCKET_TIMEOUT_MS,
} as const;

export const connection = new Redis(REDIS_URL, FAIL_FAST);

export const redis = new Redis(REDIS_URL, { ...FAIL_FAST, commandTimeout: QUEUE_DEADLINE_MS });

export const createSubscriber = (): Redis => new Redis(REDIS_URL, { enableReadyCheck: false });

export const jobQueue = new Queue<JobRequest>(JOB_QUEUE, { connection });
