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
} as const;

export type NoteKind = keyof typeof NOTE;
