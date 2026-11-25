import {
  ORCA_PROFILE_DOCUMENT_NAMES,
  type OrcaProfileDocuments,
  validateOrcaProfileDocuments,
  validatePrusaProfileContent,
} from "@conveyor/shared/profile";
import { parser } from "@lezer/json";

export interface Problem {
  file: string;
  line: number;
  text: string;
}

const LABELS: Record<string, string> = {
  machine: "Machine",
  process: "Process",
  filament: "Filament",
  config: "Settings",
};

const EMPTY = "this file is empty. Paste the settings your slicer exported for it.";

export const fileLabel = (file: string) => LABELS[file] ?? file;

export const describe = ({ file, line, text }: Problem) =>
  `${fileLabel(file)}, line ${line}: ${text}`;

const lineAt = (text: string, offset: number) =>
  text.slice(0, Math.max(0, offset)).split("\n").length;

function syntaxAt(text: string): number | null {
  let at: number | null = null;
  parser.parse(text).iterate({
    enter: (node) => {
      if (node.type.isError) at ??= node.from;
      return at === null;
    },
  });
  if (at !== null) return at;
  try {
    JSON.parse(text);
    return null;
  } catch {
    return text.length;
  }
}

function lineOf(text: string, needle: RegExp): number {
  const found = needle.exec(text);
  return found ? lineAt(text, found.index) : 1;
}

const quoted = (message: string) => message.match(/setting ("(?:[^"\\]|\\.)*")/)?.[1];
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function orcaText(message: string): string {
  const key = quoted(message);
  if (key) return `Conveyor doesn't allow the setting ${key}.`;
  if (message.includes("must contain")) return "the file must be one JSON object, inside { }.";
  if (message.includes("has type")) return `"type" must be ${message.split("expected ")[1]}.`;
  if (message.includes("exceeds")) return "the file is over the 256 KiB limit.";
  return message;
}

function orcaLine(text: string, message: string): number {
  const key = quoted(message);
  if (key) return lineOf(text, new RegExp(`${escape(key)}\\s*:`));
  return message.includes("has type") ? lineOf(text, /"type"\s*:/) : 1;
}

export function orcaProblem(documents: OrcaProfileDocuments): Problem | null {
  for (const file of ORCA_PROFILE_DOCUMENT_NAMES) {
    const text = documents[file];
    if (!text.trim()) return { file, line: 1, text: EMPTY };
    const at = syntaxAt(text);
    if (at !== null) {
      const hint = "this isn't valid JSON. Look for a missing comma, quote or bracket.";
      return { file, line: lineAt(text, at), text: hint };
    }
  }
  try {
    validateOrcaProfileDocuments(documents);
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const file = ORCA_PROFILE_DOCUMENT_NAMES.find((name) => message.startsWith(`${name}.json`));
    if (!file)
      return { file: "machine", line: 1, text: "the three files are over 768 KiB together." };
    return { file, line: orcaLine(documents[file], message), text: orcaText(message) };
  }
}

function prusaText(message: string): string {
  const key = quoted(message);
  if (key) return `Conveyor doesn't allow the setting ${key}.`;
  if (message.includes("not a key = value")) return "each line must be a setting like key = value.";
  if (message.includes("no key = value")) return "add at least one setting like key = value.";
  if (message.includes("control characters")) return "the file contains control characters.";
  return "the file is over the 512 KiB limit.";
}

function prusaLine(config: string, message: string): number {
  const numbered = message.match(/line (\d+)/)?.[1];
  if (numbered) return Number(numbered);
  const key = quoted(message);
  return key ? lineOf(config, new RegExp(`^\\s*${escape(JSON.parse(key))}\\s*=`, "m")) : 1;
}

export function prusaProblem(config: string): Problem | null {
  try {
    validatePrusaProfileContent({ config });
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { file: "config", line: prusaLine(config, message), text: prusaText(message) };
  }
}

export const problemOf = (lang: "json" | "ini", docs: Record<string, string>): Problem | null =>
  lang === "json"
    ? orcaProblem({
        machine: docs.machine ?? "",
        process: docs.process ?? "",
        filament: docs.filament ?? "",
      })
    : prusaProblem(docs.config ?? "");
