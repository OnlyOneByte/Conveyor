import { describe, expect, test } from "bun:test";
import { discoveryOutcome, parseDiscovery, parseStatusFrame } from "./sdcp";
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

describe("parseStatusFrame", () => {
  test("reads progress from a status frame", () => {
    const raw = JSON.stringify({
      Topic: "sdcp/status/mb-1",
      Data: { Status: { CurrentStatus: [1], PrintInfo: { Status: 13, Progress: 40 } } },
    });
    const read = parseStatusFrame(raw);
    expect(read.kind === "frame" && read.frame).toEqual({
      currentStatus: [1],
      printStatus: 13,
      progress: 0.4,
      currentLayer: null,
      totalLayer: null,
    });
  });

  test("a frame on another topic is skipped with its topic named", () => {
    expect(parseStatusFrame(JSON.stringify({ Topic: "sdcp/attributes/mb-1" }))).toEqual({
      kind: "other",
      reason: 'topic "sdcp/attributes/mb-1"',
    });
  });

  test("a frame that is not JSON is malformed", () => {
    expect(parseStatusFrame("{").kind).toBe("malformed");
  });

  test("a non-string topic is malformed rather than a crash", () => {
    expect(parseStatusFrame(JSON.stringify({ Topic: 7 })).kind).toBe("malformed");
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
});
