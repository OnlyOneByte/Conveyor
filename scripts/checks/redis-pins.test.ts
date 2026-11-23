import { describe, expect, test } from "bun:test";
import { redisPinErrors } from "./redis-pins";

const pinned = (ref: string) => ({
  "docker-compose.yml": `  redis:\n    image: ${ref}\n      - REDIS_URL=redis://redis:6379\n`,
  ".github/workflows/ci.yml": `      redis:\n        image: ${ref}\n      REDIS_URL: redis://127.0.0.1:6379\n`,
  "tools/visual/stack.ts": `const run = ["docker", "run", "${ref}"];\nconst url = \`redis://127.0.0.1:\${port}\`;\n`,
});

describe("redisPinErrors", () => {
  test("passes when every file pins the same image, ignoring redis:// URLs", () => {
    expect(redisPinErrors(pinned("redis:8-alpine"))).toEqual([]);
  });

  test.each([
    ["a bare major tag", "redis:8"],
    ["a minor tag", "redis:8.2-alpine"],
    ["a digest", "redis@sha256:0123abcd"],
  ])("fails when one file uses %s instead", (_label, other) => {
    const files = { ...pinned("redis:7-alpine"), ".github/workflows/ci.yml": `image: ${other}\n` };
    expect(redisPinErrors(files)).toEqual([
      `the Redis image pins must all use one reference; found redis:7-alpine (docker-compose.yml, tools/visual/stack.ts); ${other} (.github/workflows/ci.yml)`,
    ]);
  });

  test("fails naming a file that has no Redis image reference at all", () => {
    const files = {
      ...pinned("redis:8-alpine"),
      "tools/visual/stack.ts": "const url = 'redis://x:1';\n",
    };
    expect(redisPinErrors(files)).toEqual([
      "tools/visual/stack.ts: no Redis image reference found",
    ]);
  });

  test("drops sentence punctuation after a reference in prose", () => {
    const files = {
      ...pinned("redis:8-alpine"),
      "docs/contributing.md": "start redis:8-alpine.\n",
    };
    expect(redisPinErrors(files)).toEqual([]);
  });

  test.each([
    "docker.io/library/redis:8-alpine",
    "index.docker.io/library/redis:8-alpine",
    "library/redis:8-alpine",
  ])("reads the Docker Hub form %s as the same image", (ref) => {
    const files = { ...pinned("redis:8-alpine"), "docker-compose.yml": `image: ${ref}\n` };
    expect(redisPinErrors(files)).toEqual([]);
  });

  test.each([
    "ghcr.io/example/redis:8-alpine",
    "localhost:5000/redis:8-alpine",
    "bitnami/redis:8-alpine",
  ])("counts the registry-prefixed pin %s as a different image", (ref) => {
    const files = { ...pinned("redis:8-alpine"), "docker-compose.yml": `image: ${ref}\n` };
    expect(redisPinErrors(files)).toEqual([
      `the Redis image pins must all use one reference; found ${ref} (docker-compose.yml); redis:8-alpine (.github/workflows/ci.yml, tools/visual/stack.ts)`,
    ]);
  });
});
