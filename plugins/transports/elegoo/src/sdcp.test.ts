import { describe, expect, test } from "bun:test";
import { discoveryOutcome, parseDiscovery, parsePushFrame } from "./sdcp";
import { ackCode } from "./socket";

const printerReply = JSON.stringify({
  Data: { Name: "Saturn", MainboardIP: "10.0.0.8", MainboardID: "mb-1" },
});

describe("parseDiscovery", () => {
  test("reads a printer from an SDCP discovery reply", () => {
    const read = parseDiscovery(printerReply);
    expect(read).toEqual({
      kind: "frame",
      frame: {
        name: "Saturn",
        machineName: "",
        brand: "Elegoo",
        mainboardIp: "10.0.0.8",
        mainboardId: "mb-1",
        protocolVersion: undefined,
        firmwareVersion: undefined,
      },
    });
  });

  test("a JSON reply without mainboard fields is another device", () => {
    expect(parseDiscovery(JSON.stringify({ Data: { Name: "tv" } }))).toEqual({
      kind: "other",
      reason: "reply has no MainboardIP or MainboardID",
    });
  });

  test("a reply that is not JSON is malformed and quotes the reply", () => {
    const read = parseDiscovery("M99999");
    expect(read.kind).toBe("malformed");
    expect(read.kind === "malformed" && read.reason).toEndWith('in "M99999"');
  });

  test("lower-case field names from older firmware are read", () => {
    const raw = JSON.stringify({ data: { mainboardIP: "10.0.0.9", mainboardID: "mb-2" } });
    const read = parseDiscovery(raw);
    expect(read.kind === "frame" && [read.frame.mainboardIp, read.frame.mainboardId]).toEqual([
      "10.0.0.9",
      "mb-2",
    ]);
  });

  test("a non-string MainboardIP is malformed with the field named", () => {
    const read = parseDiscovery(JSON.stringify({ Data: { MainboardIP: 7, MainboardID: "mb-1" } }));
    expect(read.kind === "malformed" && read.reason).toStartWith(
      "Data.MainboardIP: Expected string",
    );
  });

  test("a JSON null reply is malformed rather than a crash", () => {
    expect(parseDiscovery("null").kind).toBe("malformed");
  });
});

describe("discoveryOutcome", () => {
  test("keeps one entry per mainboard and drops other replies", () => {
    const outcome = discoveryOutcome([
      parseDiscovery(printerReply),
      parseDiscovery(printerReply),
      parseDiscovery("garbage"),
    ]);
    expect(outcome.kind).toBe("found");
    expect(outcome.kind === "found" && outcome.printers.map((p) => p.mainboardId)).toEqual([
      "mb-1",
    ]);
  });

  test("no replies at all finds no printers", () => {
    expect(discoveryOutcome([])).toEqual({ kind: "found", printers: [] });
  });

  test("replies with no printer among them report every reason", () => {
    const outcome = discoveryOutcome([parseDiscovery("{}"), parseDiscovery("garbage")]);
    expect(outcome.kind).toBe("none");
    expect(outcome.kind === "none" && outcome.reasons).toHaveLength(2);
    expect(outcome.kind === "none" && outcome.reasons[0]).toBe(
      "reply has no MainboardIP or MainboardID",
    );
  });
});

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
    expect(read.kind === "malformed" && read.reason).toStartWith("Data.Data.Ack: Expected number");
  });
});
