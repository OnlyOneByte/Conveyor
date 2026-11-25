import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { logErrors } from "./log-errors.js";

test("an error event becomes one named log line instead of an unhandled error", () => {
  const lines: string[] = [];
  const source = logErrors(new EventEmitter(), "commands", (line) => lines.push(line));
  source.emit("error", new Error("connect ECONNREFUSED 127.0.0.1:6379"));
  expect(lines).toEqual(["[redis] commands: connect ECONNREFUSED 127.0.0.1:6379"]);
});
