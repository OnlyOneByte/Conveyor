import { type Database, SQLiteError } from "bun:sqlite";

export interface WalRetry {
  attempts: number;
  delayMs: number;
  sleep: (ms: number) => void;
}

export const WAL_RETRY: WalRetry = { attempts: 50, delayMs: 100, sleep: Bun.sleepSync };

function describeAttempts(count: number): string {
  return count === 1 ? "1 attempt" : `${count} attempts`;
}

export function enableWal(db: Database, retry = WAL_RETRY): void {
  for (let attempt = 1; ; attempt++) {
    try {
      db.exec("PRAGMA journal_mode = WAL;");
      return;
    } catch (err) {
      if (!(err instanceof SQLiteError) || err.code !== "SQLITE_BUSY") throw err;
      if (attempt >= retry.attempts)
        throw new Error(
          `could not enable WAL on ${db.filename} after ${describeAttempts(attempt)}: ${err.message}`,
          { cause: err },
        );
      retry.sleep(retry.delayMs);
    }
  }
}
