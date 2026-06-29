import { Queue } from "bullmq";
import { Redis } from "ioredis";
import type { JobRequest } from "@conveyor/shared";

const REDIS_URL = process.env.REDIS_URL ?? "redis://redis:6379";

/** BullMQ requires maxRetriesPerRequest: null on the connection used for blocking ops. */
export const connection = new Redis(REDIS_URL, { maxRetriesPerRequest: null });

/** Plain client for snapshot reads + pub/sub fan-out (separate from the blocking conn). */
export const redis = new Redis(REDIS_URL);

export const JOB_QUEUE = "conveyor:jobs";

export const jobQueue = new Queue<JobRequest>(JOB_QUEUE, { connection });
