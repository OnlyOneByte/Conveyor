import type { Database } from "bun:sqlite";

export interface SessionInput {
  id: string;
  expiresAt: number;
  passwordVersion: string;
}

export function dbCreateSession(db: Database, session: SessionInput, now: number): void {
  db.transaction(() => {
    db.query("DELETE FROM sessions WHERE expires_at < ?").run(now);
    db.query("INSERT INTO sessions (id, expires_at, password_version) VALUES (?, ?, ?)").run(
      session.id,
      session.expiresAt,
      session.passwordVersion,
    );
  })();
}

export function dbSessionPasswordVersion(db: Database, id: string, now: number): string | null {
  const row = db
    .query<{ password_version: string }, [string, number]>(
      "SELECT password_version FROM sessions WHERE id = ? AND expires_at >= ?",
    )
    .get(id, now);
  return row?.password_version ?? null;
}

export function dbDeleteSession(db: Database, id: string): void {
  db.query("DELETE FROM sessions WHERE id = ?").run(id);
}
