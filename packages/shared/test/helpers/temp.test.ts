import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { basename } from "node:path";
import { tempDirs } from "./temp.ts";
import { TEMP_PREFIXES } from "./temp-prefixes.ts";

const made: string[] = [];
const dirs = tempDirs("conveyor-temp-helper-");

test("a dir made under a watched prefix exists until the file's afterAll", async () => {
  const dir = await dirs();
  made.push(dir);
  expect(basename(dir)).toStartWith("conveyor-temp-helper-");
  expect(existsSync(dir)).toBe(true);
});

test("a prefix check:test-leaks doesn't watch is refused, naming the watched ones", () => {
  expect(() => tempDirs("scratch-")).toThrow(
    `tempDirs: scratch- doesn't start with a prefix check:test-leaks watches (${TEMP_PREFIXES.join(", ")})`,
  );
});
