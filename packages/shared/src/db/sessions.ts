import type { Database } from "bun:sqlite";

export function dbCreateSession(db: Database, id: string, expiresAt: number, now: number): void {
  db.transaction(() => {
    db.query("DELETE FROM sessions WHERE expires_at < ?").run(now);
    db.query("INSERT INTO sessions (id, expires_at) VALUES (?, ?)").run(id, expiresAt);
  })();
}

export function dbSessionActive(db: Database, id: string, now: number): boolean {
  return db.query("SELECT 1 FROM sessions WHERE id = ? AND expires_at >= ?").get(id, now) !== null;
}

export function dbDeleteSession(db: Database, id: string): void {
  db.query("DELETE FROM sessions WHERE id = ?").run(id);
}
