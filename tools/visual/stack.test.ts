import { afterEach, describe, expect, test } from "bun:test";
import { redisContainer, stackEnv } from "./stack.ts";

const opts = {
  redisUrl: "redis://127.0.0.1:6379",
  dataDir: "/tmp/conveyor-visual-x",
  apiPort: 4321,
};

describe("stackEnv", () => {
  test("runs the API with auth disabled on loopback only", () => {
    const env = stackEnv({}, opts);
    expect(env.CONVEYOR_AUTH).toBe("disabled");
    expect(env.CONVEYOR_HOST).toBe("127.0.0.1");
    expect(env.CONVEYOR_API_TARGET).toBe("http://127.0.0.1:4321");
  });

  test("overrides auth and host inherited from the runner", () => {
    const env = stackEnv({ CONVEYOR_AUTH: "enabled", CONVEYOR_HOST: "0.0.0.0" }, opts);
    expect(env.CONVEYOR_AUTH).toBe("disabled");
    expect(env.CONVEYOR_HOST).toBe("127.0.0.1");
  });

  test("points REDIS_URL at the stack's own Redis even when the runner sets one", () => {
    const env = stackEnv({ REDIS_URL: "redis://prod.example:6379" }, opts);
    expect(env.REDIS_URL).toBe("redis://127.0.0.1:6379");
  });

  test("pins the engines to stub mode", () => {
    const env = stackEnv({ CONVEYOR_ENGINE_STUB: "0" }, opts);
    expect(env.CONVEYOR_ENGINE_STUB).toBe("1");
  });
});

describe("redisContainer", () => {
  const runnerRedisUrl = process.env.REDIS_URL;
  afterEach(() => {
    if (runnerRedisUrl === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = runnerRedisUrl;
  });

  test("ignores the runner's REDIS_URL and targets its own loopback container", () => {
    process.env.REDIS_URL = "redis://prod.example:6379";
    const container = redisContainer(6390);
    expect(container.url).toBe("redis://127.0.0.1:6390");
    expect(container.dockerRun).toEqual([
      "docker",
      "run",
      "-d",
      "--rm",
      "-p",
      "127.0.0.1:6390:6379",
      "redis:7-alpine",
    ]);
  });
});
