import { describe, expect, test } from "bun:test";
import { redisPinErrors } from "./redis-pins";

const digest = (hex: string) => `@sha256:${hex.repeat(64)}`;
const PIN = `redis:8-alpine${digest("a")}`;
const OLD = `redis:7-alpine${digest("b")}`;

const pinned = (ref: string) => ({
  "docker-compose.yml": `  redis:\n    image: ${ref}\n      - REDIS_URL=redis://redis:6379\n`,
  ".github/workflows/ci.yml": `      redis:\n        image: ${ref}\n      REDIS_URL: redis://127.0.0.1:6379\n`,
  "tools/visual/stack.ts": `const run = ["docker", "run", "${ref}"];\nconst url = \`redis://127.0.0.1:\${port}\`;\n`,
});

describe("redisPinErrors", () => {
  test("passes when every file pins the same image by digest, ignoring redis:// URLs", () => {
    expect(redisPinErrors(pinned(PIN))).toEqual([]);
  });

  test.each([
    ["a floating tag", "redis:8-alpine"],
    ["a short digest", "redis:8-alpine@sha256:0123abcd"],
    ["an uppercase digest", `redis:8-alpine@sha256:${"A".repeat(64)}`],
  ])("fails when every file agrees on %s", (_label, ref) => {
    expect(redisPinErrors(pinned(ref))).toEqual([
      `the Redis image pin ${ref} isn't pinned by digest (@sha256:<64 hex>)`,
    ]);
  });

  test.each([
    ["a bare major tag", `redis:8${digest("c")}`],
    ["a minor tag", `redis:8.2-alpine${digest("c")}`],
    ["a bare digest", `redis${digest("c")}`],
  ])("fails when one file uses %s instead", (_label, other) => {
    const files = { ...pinned(OLD), ".github/workflows/ci.yml": `image: ${other}\n` };
    expect(redisPinErrors(files)).toEqual([
      `the Redis image pins must all use one reference; found ${OLD} (docker-compose.yml, tools/visual/stack.ts); ${other} (.github/workflows/ci.yml)`,
    ]);
  });

  test("fails on both counts when one file drops the digest", () => {
    const files = { ...pinned(PIN), ".github/workflows/ci.yml": "image: redis:8-alpine\n" };
    expect(redisPinErrors(files)).toEqual([
      "the Redis image pin redis:8-alpine isn't pinned by digest (@sha256:<64 hex>)",
      `the Redis image pins must all use one reference; found ${PIN} (docker-compose.yml, tools/visual/stack.ts); redis:8-alpine (.github/workflows/ci.yml)`,
    ]);
  });

  test("fails naming a file that has no Redis image reference at all", () => {
    const files = { ...pinned(PIN), "tools/visual/stack.ts": "const url = 'redis://x:1';\n" };
    expect(redisPinErrors(files)).toEqual([
      "tools/visual/stack.ts: no Redis image reference found",
    ]);
  });

  test("drops sentence punctuation after a reference in prose", () => {
    const files = { ...pinned(PIN), "docs/contributing.md": `start ${PIN}.\n` };
    expect(redisPinErrors(files)).toEqual([]);
  });

  test.each([`docker.io/library/${PIN}`, `index.docker.io/library/${PIN}`, `library/${PIN}`])(
    "reads the Docker Hub form %s as the same image",
    (ref) => {
      const files = { ...pinned(PIN), "docker-compose.yml": `image: ${ref}\n` };
      expect(redisPinErrors(files)).toEqual([]);
    },
  );

  test.each([`ghcr.io/example/${PIN}`, `localhost:5000/${PIN}`, `bitnami/${PIN}`])(
    "counts the registry-prefixed pin %s as a different image",
    (ref) => {
      const files = { ...pinned(PIN), "docker-compose.yml": `image: ${ref}\n` };
      expect(redisPinErrors(files)).toEqual([
        `the Redis image pins must all use one reference; found ${ref} (docker-compose.yml); ${PIN} (.github/workflows/ci.yml, tools/visual/stack.ts)`,
      ]);
    },
  );
});
