import { describe, expect, test } from "bun:test";
import { parsePushFrame } from "./sdcp";
import { ackCode } from "./socket";

describe("parsePushFrame", () => {
  test("reads progress from a status frame", () => {
    const raw = JSON.stringify({
      Topic: "sdcp/status/mb-1",
      Data: { Status: { CurrentStatus: [1], PrintInfo: { Status: 13, Progress: 40 } } },
    });
    const read = parsePushFrame(raw);
    expect(read.kind === "frame" && read.frame).toEqual({
      kind: "status",
      status: {
        currentStatus: [1],
        printStatus: 13,
        progress: 0.4,
        currentLayer: null,
        totalLayer: null,
        currentTicks: null,
        totalTicks: null,
      },
    });
  });

  test("a scalar CurrentStatus and layer counts give layer progress", () => {
    const raw = JSON.stringify({
      Topic: "sdcp/status/mb-1",
      Data: { Status: { CurrentStatus: 1, PrintInfo: { CurrentLayer: 30, TotalLayer: 120 } } },
    });
    const read = parsePushFrame(raw);
    expect(read.kind === "frame" && read.frame.kind === "status" && read.frame.status).toEqual({
      currentStatus: [1],
      printStatus: null,
      progress: 0.25,
      currentLayer: 30,
      totalLayer: 120,
      currentTicks: null,
      totalTicks: null,
    });
  });

  test("a status frame with no Data reads as idle with no progress", () => {
    const read = parsePushFrame(JSON.stringify({ Topic: "sdcp/status/mb-1" }));
    expect(read.kind === "frame" && read.frame.kind === "status" && read.frame.status).toEqual({
      currentStatus: [],
      printStatus: null,
      progress: 0,
      currentLayer: null,
      totalLayer: null,
      currentTicks: null,
      totalTicks: null,
    });
  });

  test("an error frame carries the printer's error code", () => {
    const raw = JSON.stringify({ Topic: "sdcp/error/mb-1", Data: { Data: { ErrorCode: 2 } } });
    expect(parsePushFrame(raw)).toEqual({ kind: "frame", frame: { kind: "error", errorCode: 2 } });
  });

  test("an error frame without a numeric ErrorCode is malformed with the field named", () => {
    const raw = JSON.stringify({ Topic: "sdcp/error/mb-1", Data: { Data: { ErrorCode: true } } });
    const read = parsePushFrame(raw);
    expect(read.kind === "malformed" && read.reason).toStartWith("Data.ErrorCode: Invalid input");
  });

  test("a numeric-string Progress is read as a number", () => {
    const raw = JSON.stringify({
      Topic: "sdcp/status/mb-1",
      Data: { Status: { PrintInfo: { Status: "13", Progress: "40" } } },
    });
    const read = parsePushFrame(raw);
    expect(read.kind === "frame" && read.frame.kind === "status" && read.frame.status).toEqual({
      currentStatus: [],
      printStatus: 13,
      progress: 0.4,
      currentLayer: null,
      totalLayer: null,
      currentTicks: null,
      totalTicks: null,
    });
  });

  test("a non-numeric Progress string is malformed with its path named", () => {
    const raw = JSON.stringify({
      Topic: "sdcp/status/mb-1",
      Data: { Status: { PrintInfo: { Progress: "40%" } } },
    });
    const read = parsePushFrame(raw);
    expect(read.kind === "malformed" && read.reason).toStartWith(
      "Status.PrintInfo.Progress: Invalid input",
    );
  });

  test("a notice or attributes frame is skipped with its topic named", () => {
    expect(parsePushFrame(JSON.stringify({ Topic: "sdcp/notice/mb-1" }))).toEqual({
      kind: "other",
      reason: 'topic "sdcp/notice/mb-1"',
    });
  });

  test("a frame that is not JSON is malformed", () => {
    expect(parsePushFrame("{").kind).toBe("malformed");
  });

  test("a non-string topic is malformed rather than a crash", () => {
    expect(parsePushFrame(JSON.stringify({ Topic: 7 })).kind).toBe("malformed");
  });
});

describe("ackCode", () => {
  test("reads the ack code for the matching request", () => {
    const raw = JSON.stringify({ Data: { RequestID: "r1", Data: { Ack: 2 } } });
    expect(ackCode(raw, "r1")).toEqual({ kind: "frame", frame: 2 });
  });

  test("an ack for another request is skipped", () => {
    const raw = JSON.stringify({ Data: { RequestID: "r2", Data: { Ack: 0 } } });
    expect(ackCode(raw, "r1")).toEqual({ kind: "other", reason: "not an ack for this request" });
  });

  test("an unreadable reply is malformed", () => {
    expect(ackCode("pong", "r1").kind).toBe("malformed");
  });

  test("a non-numeric Ack is malformed instead of read as a code", () => {
    const raw = JSON.stringify({ Data: { RequestID: "r1", Data: { Ack: "ok" } } });
    const read = ackCode(raw, "r1");
    expect(read.kind === "malformed" && read.reason).toStartWith(
      "Data.Data.Ack: Invalid input: expected number, received string",
    );
  });
});
