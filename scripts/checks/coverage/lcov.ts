export type LineHits = Map<number, number>;

export type Coverage = Map<string, LineHits>;

const addHit = (lines: LineHits, body: string) => {
  const [line, hits] = body.split(",").map(Number);
  if (line === undefined || hits === undefined) return;
  if (!Number.isInteger(line) || !Number.isFinite(hits)) return;
  lines.set(line, (lines.get(line) ?? 0) + hits);
};

export function parseLcov(text: string): Coverage {
  const coverage: Coverage = new Map();
  let lines: LineHits | null = null;
  for (const raw of text.split("\n")) {
    const record = raw.trim();
    if (record.startsWith("SF:")) {
      const file = record.slice(3);
      lines = coverage.get(file) ?? new Map();
      coverage.set(file, lines);
    } else if (record.startsWith("DA:") && lines) {
      addHit(lines, record.slice(3));
    } else if (record === "end_of_record") {
      lines = null;
    }
  }
  return coverage;
}

export const hitCount = (lines: LineHits) => [...lines.values()].filter((hits) => hits > 0).length;

export const zeroed = (lines: LineHits): LineHits => new Map([...lines.keys()].map((n) => [n, 0]));

export function projectHits(lines: LineHits, run: LineHits): LineHits {
  const marks = [...run.entries()].sort(([a], [b]) => a - b);
  const projected: LineHits = new Map();
  let hits = 0;
  let next = 0;
  for (const line of [...lines.keys()].sort((a, b) => a - b)) {
    for (; next < marks.length && (marks[next]?.[0] ?? line + 1) <= line; next += 1) {
      hits = marks[next]?.[1] ?? 0;
    }
    projected.set(line, hits);
  }
  return projected;
}

const serializeFile = (file: string, lines: LineHits) => {
  const sorted = [...lines.entries()].sort(([a], [b]) => a - b);
  return [
    `SF:${file}`,
    ...sorted.map(([line, hits]) => `DA:${line},${hits}`),
    `LF:${lines.size}`,
    `LH:${hitCount(lines)}`,
    "end_of_record",
  ].join("\n");
};

export function serializeLcov(coverage: Coverage): string {
  const files = [...coverage.entries()].sort(([a], [b]) => a.localeCompare(b));
  return `${files.map(([file, lines]) => serializeFile(file, lines)).join("\n")}\n`;
}
