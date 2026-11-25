interface KeyInput {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  target?: unknown;
}

const FIELDS = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';
export const inTextField = (target: unknown) =>
  typeof Element !== "undefined" && target instanceof Element && target.matches(FIELDS);

export const CHORD_MS = 1500;

export const keyName = ({ key, metaKey, ctrlKey, shiftKey }: KeyInput) =>
  metaKey || ctrlKey
    ? `mod+${key.toLowerCase()}`
    : shiftKey && /^[a-z]$/i.test(key)
      ? `shift+${key.toLowerCase()}`
      : key.length === 1
        ? key.toLowerCase()
        : key;

export function createShortcuts({
  singleKeys = (): boolean => true,
  inField = inTextField,
  now = () => Date.now(),
} = {}) {
  const bindings = new Map<string, () => void>();
  let pending: { key: string; at: number } | null = null;
  const register = (keys: string, run: () => void) => {
    if (bindings.has(keys)) throw new Error(`shortcut "${keys}" is already registered`);
    bindings.set(keys, run);
    return () => void bindings.delete(keys);
  };
  const handle = (input: KeyInput): boolean => {
    const name = keyName(input);
    const chord = pending && now() - pending.at <= CHORD_MS ? pending.key : null;
    pending = null;
    if (input.altKey || (!name.startsWith("mod+") && (inField(input.target) || !singleKeys())))
      return false;
    const run = bindings.get(chord ? `${chord} ${name}` : name);
    if (run) {
      run();
      return true;
    }
    if (chord || ![...bindings.keys()].some((k) => k.startsWith(`${name} `))) return false;
    pending = { key: name, at: now() };
    return true;
  };
  return { register, handle };
}

export const step = (at: number, by: number, count: number) =>
  Math.min(count - 1, Math.max(0, at + by));

export const SHEET = [
  ["⌘K / Ctrl K", "Open the command menu"],
  ["N", "New print"],
  ["G then M, J or P", "Go to Make, Jobs or Printers"],
  ["T", "Switch theme"],
  ["J / K", "Next or previous job (Jobs)"],
  ["C / R", "Cancel or retry the selected job (Jobs)"],
  ["/", "Focus the filter (Jobs)"],
  ["?", "Show these shortcuts"],
] as const;
