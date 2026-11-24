export interface Command {
  group: "Jobs" | "Actions" | "Printers";
  label: string;
  hint: string;
  run: () => void;
}

const ORDER: Command["group"][] = ["Jobs", "Actions", "Printers"];

export function matchCommands(all: Command[], query: string): Command[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = all.filter((c) => words.every((w) => `${c.label} ${c.hint}`.toLowerCase().includes(w)));
  return ORDER.flatMap((group) => hits.filter((c) => c.group === group));
}
