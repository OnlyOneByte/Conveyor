import { describe, expect, test } from "bun:test";
import { ago } from "./ago.js";

const NOW = Date.UTC(2026, 0, 2, 12);

describe("ago", () => {
  test("floors each unit rather than rounding it", () => {
    const before = (seconds: number) => ago(NOW - seconds * 1000, NOW);
    expect([59, 60, 119, 3599, 3600, 7199, 86_399, 86_400, 172_799].map(before)).toEqual([
      "just now", "1m ago", "1m ago", "59m ago", "1h ago", "1h ago", "23h ago", "1d ago", "1d ago",
    ]);
  });
});
