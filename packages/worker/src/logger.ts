import pino, { type DestinationStream, type Logger } from "pino";

export function createLogger(destination?: DestinationStream): Logger {
  return pino(
    {
      base: { service: "worker" },
      formatters: { level: (label) => ({ level: label }) },
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    destination,
  );
}

export const logger = createLogger();

export function jobLog(jobId: string, parent: Logger = logger): (msg: string) => void {
  const child = parent.child({ jobId });
  return (msg) => child.info(msg);
}
