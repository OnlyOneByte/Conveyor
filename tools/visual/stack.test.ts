import { describe, expect, test } from "bun:test";
import { stackEnv } from "./stack.ts";

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
