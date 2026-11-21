import orca from "../slicer-keys/orca.json";
import prusa from "../slicer-keys/prusa.json";
import { DENIED_KEY } from "./slicer-key-policy.js";

const KEY = /^[A-Za-z0-9_]+$/;

export function toKeySet(name: string, value: unknown): ReadonlySet<string> {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${name} slicer keys must be a non-empty array`);
  }
  const keys = new Set<string>();
  for (const key of value) {
    if (typeof key !== "string" || !KEY.test(key) || DENIED_KEY.test(key)) {
      throw new Error(`${name} slicer keys contain an invalid entry: ${JSON.stringify(key)}`);
    }
    keys.add(key);
  }
  return keys;
}

export const PRUSA_CONFIG_KEYS = toKeySet("prusa", prusa);
export const ORCA_CONFIG_KEYS = toKeySet("orca", orca);
