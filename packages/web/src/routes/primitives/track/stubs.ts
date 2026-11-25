import type { TrackJob } from "#lib/track.js";

const NAMES = [
  "Gridfinity bin 2×3 · 6u",
  "Gridfinity bin 1×1 · 3u",
  "cable-clip.stl",
  "Gridfinity bin 4×2 · 4u",
  "Gridfinity baseplate 5×4",
];
const PRINTERS = ["Ender 3 V3", "Voron 2.4", "Centauri Carbon"];
let next = 0;
const job = (state: TrackJob["state"], progress?: number): TrackJob => {
  const i = next++;
  return {
    id: `stub-${i}`,
    name: NAMES[i % NAMES.length] ?? "Job",
    state,
    progress,
    printer: PRINTERS[i % PRINTERS.length],
  };
};
const queued = (n: number) => Array.from({ length: n }, () => job("queued"));

export const STUBS: Record<string, () => TrackJob[]> = {
  "0": () => [job("done"), job("done")],
  "1": () => [job("printing", 0.64)],
  "3": () => [job("printing", 0.64), job("slicing", 0.35), job("queued")],
  "8": () => [
    job("generating"),
    job("slicing", 0.35),
    job("printing", 0.64),
    ...queued(3),
    job("done"),
    job("failed"),
  ],
  "20": () => [
    job("slicing", 0.1),
    job("slicing", 0.4),
    job("slicing", 0.7),
    job("transferring", 0.9),
    job("printing", 0.6),
    ...queued(13),
    job("done"),
    job("failed"),
  ],
  states: () => [
    job("queued"),
    job("generating"),
    job("slicing", 0.35),
    job("transferring", 0.72),
    job("printing", 0.64),
    job("done"),
    job("failed"),
    job("canceled"),
  ],
};
