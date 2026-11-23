import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { bootStack, redisContainer, type StackChild, type StackDeps, stackEnv } from "./stack.ts";
import { EXIT_TRIGGERS } from "./teardown.ts";

const opts = {
  root: "/repo",
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

  test("points the worker at the checkout's bundled profiles, not the runner's", () => {
    const env = stackEnv({ CONVEYOR_PROFILES_ROOT: "/profiles" }, opts);
    expect(env.CONVEYOR_PROFILES_ROOT).toBe("/repo/profiles");
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
      "redis:8-alpine",
    ]);
  });
});

interface FakeStack {
  deps: StackDeps;
  children: { name: string; signals: string[] }[];
  dockerCalls: string[][];
  dataDirs: string[];
  seeded: { root: string; dbPath: string; spawnedBefore: number }[];
  listenersAtSpawn: number[][];
  emitter: EventEmitter;
  sleeps: number[];
  exits: number[];
}

function closedStream(): ReadableStream<Uint8Array> {
  return new ReadableStream({ start: (controller) => controller.close() });
}

function nameOf(cmd: string[]): string {
  if (cmd.includes("preview")) return "web";
  if (cmd.includes("build")) return "build";
  return "service";
}

function fakeStack(options: { apiExitCode: number | null; dockerRmExitCode: number }): FakeStack {
  const emitter = new EventEmitter();
  const fake: FakeStack = {
    children: [],
    dockerCalls: [],
    dataDirs: [],
    seeded: [],
    listenersAtSpawn: [],
    emitter,
    sleeps: [],
    exits: [],
    deps: {
      events: {
        on: (event, listener) => emitter.on(event, listener),
        off: (event, listener) => emitter.off(event, listener),
      },
      exit: (code) => {
        fake.exits.push(code);
      },
      seed: async (root, env) => {
        fake.seeded.push({ root, dbPath: env.DB_PATH ?? "", spawnedBefore: fake.children.length });
      },
      sleep: (ms) => {
        fake.sleeps.push(ms);
        return new Promise<void>(() => {});
      },
      spawnSync: (cmd) => {
        fake.dockerCalls.push(cmd);
        const isRm = cmd[1] === "rm";
        return {
          exitCode: isRm ? options.dockerRmExitCode : 0,
          stdout: Buffer.from(cmd[1] === "exec" ? "PONG\n" : "cid-1\n"),
          stderr: Buffer.from(isRm ? "daemon gone" : ""),
        };
      },
      spawn: ({ cmd, cwd, env }) => {
        const name = cmd.includes("vite") ? nameOf(cmd) : (cwd.split("/").at(-1) ?? "");
        fake.dataDirs.push(env.DATA_DIR ?? "");
        fake.listenersAtSpawn.push(EXIT_TRIGGERS.map((t) => emitter.listenerCount(t)));
        const record = { name, signals: [] as string[] };
        fake.children.push(record);
        const { promise, resolve } = Promise.withResolvers<number>();
        const port = name === "api" ? env.PORT : cmd[cmd.indexOf("--port") + 1];
        const exitCode = name === "build" ? 0 : name === "api" ? options.apiExitCode : null;
        const server =
          exitCode === null && (name === "api" || name === "web")
            ? Bun.serve({
                hostname: "127.0.0.1",
                port: Number(port),
                fetch: () => new Response("ok"),
              })
            : undefined;
        if (exitCode !== null) resolve(exitCode);
        const child: StackChild = {
          pid: 4000 + fake.children.length,
          exitCode,
          exited: promise,
          stdout: closedStream(),
          stderr: closedStream(),
          kill: (signal) => {
            record.signals.push(signal ?? "SIGTERM");
            server?.stop(true);
            resolve(143);
          },
        };
        return child;
      },
    },
  };
  return fake;
}

describe("bootStack teardown wiring", () => {
  test("stop kills every child, removes the container and the data dir, and detaches", async () => {
    const fake = fakeStack({ apiExitCode: null, dockerRmExitCode: 0 });
    const stack = await bootStack("/repo", () => {}, fake.deps);
    expect(fake.children.map((c) => c.name)).toEqual(["api", "worker", "build", "web"]);
    expect(fake.listenersAtSpawn[0]).toEqual([1, 1, 1, 1]);
    expect(existsSync(fake.dataDirs[0] ?? "")).toBe(true);
    expect(fake.seeded).toEqual([
      { root: "/repo", dbPath: `${fake.dataDirs[0]}/conveyor.db`, spawnedBefore: 0 },
    ]);
    await stack.stop();
    expect(fake.children.map((c) => c.signals)).toEqual([
      ["SIGTERM"],
      ["SIGTERM"],
      ["SIGTERM"],
      ["SIGTERM"],
    ]);
    expect(fake.dockerCalls).toContainEqual(["docker", "rm", "-f", "cid-1"]);
    expect(existsSync(fake.dataDirs[0] ?? "")).toBe(false);
    expect(EXIT_TRIGGERS.map((t) => fake.emitter.listenerCount(t))).toEqual([0, 0, 0, 0]);
  });

  test("a failed docker rm makes stop reject with docker's message", async () => {
    const fake = fakeStack({ apiExitCode: null, dockerRmExitCode: 1 });
    const stack = await bootStack("/repo", () => {}, fake.deps);
    await expect(stack.stop()).rejects.toThrow("docker rm -f cid-1 failed: daemon gone");
    expect(existsSync(fake.dataDirs[0] ?? "")).toBe(false);
  });

  test("a boot failure tears down what already started and rethrows the cause", async () => {
    const fake = fakeStack({ apiExitCode: 1, dockerRmExitCode: 0 });
    await expect(bootStack("/repo", () => {}, fake.deps)).rejects.toThrow("exited with 1");
    expect(fake.children.map((c) => c.signals)).toEqual([["SIGTERM"]]);
    expect(fake.dockerCalls).toContainEqual(["docker", "rm", "-f", "cid-1"]);
    expect(existsSync(fake.dataDirs[0] ?? "")).toBe(false);
  });

  test("a failed seed starts no child and tears down Redis and the temp dir", async () => {
    const fake = fakeStack({ apiExitCode: null, dockerRmExitCode: 0 });
    let dataDir = "";
    fake.deps.seed = async (_root, env) => {
      dataDir = env.DATA_DIR ?? "";
      throw new Error("table jobs has no column named stage");
    };
    await expect(bootStack("/repo", () => {}, fake.deps)).rejects.toThrow("no column named stage");
    expect(fake.children).toEqual([]);
    expect(fake.dockerCalls).toContainEqual(["docker", "rm", "-f", "cid-1"]);
    expect(dataDir).not.toBe("");
    expect(existsSync(dataDir)).toBe(false);
    expect(EXIT_TRIGGERS.map((t) => fake.emitter.listenerCount(t))).toEqual([0, 0, 0, 0]);
  });

  test("gives every child 5 s after SIGTERM before SIGKILL", async () => {
    const fake = fakeStack({ apiExitCode: null, dockerRmExitCode: 0 });
    const stack = await bootStack("/repo", () => {}, fake.deps);
    await stack.stop();
    expect(fake.sleeps).toEqual([5000, 5000, 5000, 5000]);
  });

  test("a forced exit names the running children, the Redis container and the temp dir", async () => {
    const fake = fakeStack({ apiExitCode: null, dockerRmExitCode: 0 });
    const stack = await bootStack("/repo", () => {}, fake.deps);
    const errors = spyOn(console, "error").mockImplementation(() => {});
    try {
      fake.emitter.emit("SIGINT");
      fake.emitter.emit("SIGINT");
      expect(fake.exits).toEqual([130]);
      const message = String(errors.mock.calls[0]?.[0]);
      expect(message).toContain("Redis container cid-1 (remove it with: docker rm -f cid-1)");
      expect(message).toContain("api process 4001 (kill it with: kill -9 4001)");
      expect(message).toContain("web process 4004");
      expect(message).not.toContain("build process");
      expect(message).toContain(`temp directory ${fake.dataDirs[0]}`);
    } finally {
      await stack.stop();
      errors.mockRestore();
    }
  });
});
