import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runners } from "./step.ts";

const dir = join(import.meta.dir, "steps");
const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

test("every step kind documents itself in steps/<kind>.md, naming its own kind", () => {
  expect(files.length).toBe(runners.size);
  for (const file of files) {
    const doc = join(dir, file.replace(/\.ts$/, ".md"));
    expect(existsSync(doc)).toBe(true);
    const source = readFileSync(join(dir, file), "utf8");
    const kind = /kind:\s*"([^"]+)"/.exec(source)?.[1];
    expect(kind).toBeDefined();
    expect(readFileSync(doc, "utf8")).toContain(`\`${kind}\``);
  }
});
