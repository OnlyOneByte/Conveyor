import { NOTE, type NoteKind } from "@conveyor/shared/job-notes";

export const SAID: Record<NoteKind, string> = {
  canceledOnPrinter: "It was canceled on the printer.",
  stopUnconfirmed: "The printer didn't confirm it stopped. Check the printer.",
  cannotStop: "This printer can't be stopped from Conveyor. Stop it on the printer.",
  streamNotClosed: "The printer's status updates didn't end cleanly.",
  seenNotRecorded: "Conveyor couldn't save when it last heard from the printer.",
  filamentNotRead: "Conveyor couldn't read how much filament this used.",
  profileNotRemoved: "A temporary copy of the profile wasn't cleaned up.",
  workDirNotRemoved: "This job's working files weren't cleaned up.",
  historyNotRecorded: "Conveyor had trouble saving this job to the history.",
};

const isKind = (kind: string): kind is NoteKind => Object.hasOwn(SAID, kind);
const PLAIN = Object.entries(NOTE).flatMap(([kind, prefix]): [string, string][] =>
  isKind(kind) ? [[prefix, SAID[kind]]] : [],
);

const OTHER = "Conveyor noted something else about this job.";
const BOUNDARY = new RegExp(`; (?=${PLAIN.map(([prefix]) => prefix).join("|")})`);

export interface JobNote {
  plain: string[];
  raw: string | null;
}

export function readNote(notes: string | undefined): JobNote | null {
  const text = notes?.trim();
  if (!text) return null;
  const said = text
    .split(BOUNDARY)
    .map((part) => PLAIN.find(([prefix]) => part.startsWith(prefix))?.[1] ?? null);
  if (!said.some(Boolean)) return { plain: [text], raw: null };
  return { plain: [...new Set(said.map((line) => line ?? OTHER))], raw: text };
}

export const plainNote = (notes: string | undefined) => readNote(notes)?.plain.join(" ") ?? "";

export const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text || undefined;
