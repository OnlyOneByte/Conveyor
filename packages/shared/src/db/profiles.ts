import type { Database } from "bun:sqlite";
import type { OrcaProfileDocuments, PrusaProfileDocument } from "../profile.js";

export interface Profile {
  id: string;
  slicerId: string;
  name: string;
  path: string;
  gcodeFlavor: string;
  hasEditableContent?: boolean;
}

interface ProfileRow {
  id: string;
  slicer_id: string;
  name: string;
  path: string;
  gcode_flavor: string;
  orca_machine_json: string | null;
  orca_process_json: string | null;
  orca_filament_json: string | null;
  prusa_ini: string | null;
}

function rowToProfile(r: ProfileRow): Profile {
  const orcaEdited =
    r.orca_machine_json !== null && r.orca_process_json !== null && r.orca_filament_json !== null;
  const prusaEdited = r.prusa_ini !== null;
  return {
    id: r.id,
    slicerId: r.slicer_id,
    name: r.name,
    path: r.path,
    gcodeFlavor: r.gcode_flavor,
    ...(orcaEdited || prusaEdited ? { hasEditableContent: true } : {}),
  };
}

export function dbListProfiles(db: Database): Profile[] {
  return (db.query("SELECT * FROM profiles ORDER BY name").all() as ProfileRow[]).map(rowToProfile);
}

export function dbGetProfile(db: Database, id: string): Profile | null {
  const row = db.query("SELECT * FROM profiles WHERE id = ?").get(id) as ProfileRow | null;
  return row ? rowToProfile(row) : null;
}

interface OrcaDocumentsRow {
  orca_machine_json: string | null;
  orca_process_json: string | null;
  orca_filament_json: string | null;
}

export function dbGetOrcaProfileDocuments(db: Database, id: string): OrcaProfileDocuments | null {
  const row = db
    .query(
      "SELECT orca_machine_json, orca_process_json, orca_filament_json FROM profiles WHERE id = ?",
    )
    .get(id) as OrcaDocumentsRow | null;
  if (!row) return null;
  const {
    orca_machine_json: machine,
    orca_process_json: processDoc,
    orca_filament_json: filament,
  } = row;
  if (machine === null && processDoc === null && filament === null) return null;
  if (machine === null || processDoc === null || filament === null) {
    throw new Error(`profile ${id} has incomplete Orca content`);
  }
  return { machine, process: processDoc, filament };
}

export function dbSaveOrcaProfileDocuments(
  db: Database,
  id: string,
  documents: OrcaProfileDocuments,
): boolean {
  const result = db
    .prepare(
      `UPDATE profiles
       SET orca_machine_json = ?, orca_process_json = ?, orca_filament_json = ?
       WHERE id = ?`,
    )
    .run(documents.machine, documents.process, documents.filament, id);
  return result.changes > 0;
}

export function dbResetOrcaProfileDocuments(db: Database, id: string): boolean {
  const result = db
    .prepare(
      `UPDATE profiles
       SET orca_machine_json = NULL, orca_process_json = NULL, orca_filament_json = NULL
       WHERE id = ?`,
    )
    .run(id);
  return result.changes > 0;
}

export function dbGetPrusaProfileContent(db: Database, id: string): PrusaProfileDocument | null {
  const row = db.query("SELECT prusa_ini FROM profiles WHERE id = ?").get(id) as {
    prusa_ini: string | null;
  } | null;
  if (!row || row.prusa_ini === null) return null;
  return { config: row.prusa_ini };
}

export function dbSavePrusaProfileContent(
  db: Database,
  id: string,
  document: PrusaProfileDocument,
): boolean {
  const result = db
    .prepare("UPDATE profiles SET prusa_ini = ? WHERE id = ?")
    .run(document.config, id);
  return result.changes > 0;
}

export function dbResetPrusaProfileContent(db: Database, id: string): boolean {
  const result = db.prepare("UPDATE profiles SET prusa_ini = NULL WHERE id = ?").run(id);
  return result.changes > 0;
}

export function dbUpsertProfile(db: Database, p: Profile): void {
  db.prepare(
    `INSERT INTO profiles (id, slicer_id, name, path, gcode_flavor, created_at)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       slicer_id=excluded.slicer_id, name=excluded.name, path=excluded.path, gcode_flavor=excluded.gcode_flavor`,
  ).run(p.id, p.slicerId, p.name, p.path, p.gcodeFlavor, Date.now());
}

export function dbDeleteProfile(db: Database, id: string): void {
  db.prepare("DELETE FROM profiles WHERE id = ?").run(id);
}
