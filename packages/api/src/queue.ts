import { JOB_QUEUE, type JobRequest } from "@conveyor/shared";
import { Queue } from "bullmq";
import { Redis } from "ioredis";

const REDIS_URL = process.env.REDIS_URL ?? "redis://redis:6379";

export const connection = new Redis(REDIS_URL, { maxRetriesPerRequest: null });

export const redis = new Redis(REDIS_URL);

export const jobQueue = new Queue<JobRequest>(JOB_QUEUE, { connection });
