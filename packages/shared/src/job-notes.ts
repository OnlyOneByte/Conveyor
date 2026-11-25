export const NOTE = {
  canceledOnPrinter: "canceled on printer",
  stopUnconfirmed: "cancel requested but the printer did not confirm the stop",
  cannotStop: "cancel requested but transport",
  streamNotClosed: "status stream did not close cleanly",
  seenNotRecorded: "printer last-seen time not recorded",
  filamentNotRead: "filament use not read",
  profileNotRemoved: "materialized profile not removed",
  workDirNotRemoved: "work dir not removed",
  historyNotRecorded: "history not recorded after",
  resumeNoHandle: "resume failed: no stored print handle",
  resumeUnknownTransport: "resume failed: unknown transport",
  resumeConnectionLost: "resume failed: connection lost before completion",
  resumeError: "resume failed",
} as const;

export type NoteKind = keyof typeof NOTE;

const JOIN: Partial<Record<NoteKind, string>> = { cannotStop: " ", historyNotRecorded: " " };

export interface Note {
  kind: NoteKind;
  detail?: string;
}

export const note = (kind: NoteKind, detail?: string): Note =>
  detail === undefined ? { kind } : { kind, detail };

export const noteText = ({ kind, detail }: Note): string =>
  detail === undefined ? NOTE[kind] : `${NOTE[kind]}${JOIN[kind] ?? ": "}${detail}`;
