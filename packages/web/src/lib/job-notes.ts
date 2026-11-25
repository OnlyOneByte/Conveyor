const PLAIN: [string, string][] = [
  ["canceled on printer", "It was canceled on the printer."],
  [
    "cancel requested but the printer did not confirm the stop",
    "The printer didn't confirm it stopped. Check the printer.",
  ],
  [
    "cancel requested but transport",
    "This printer can't be stopped from Conveyor. Stop it on the printer.",
  ],
  ["status stream did not close cleanly", "The printer's status updates didn't end cleanly."],
  [
    "printer last-seen time not recorded",
    "Conveyor couldn't save when it last heard from the printer.",
  ],
  ["filament use not read", "Conveyor couldn't read how much filament this used."],
  ["materialized profile not removed", "A temporary copy of the profile wasn't cleaned up."],
  ["work dir not removed", "This job's working files weren't cleaned up."],
  ["history not recorded after", "Conveyor had trouble saving this job to the history."],
];

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
