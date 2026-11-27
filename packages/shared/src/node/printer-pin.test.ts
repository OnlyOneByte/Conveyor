import { describe, expect, test } from "bun:test";
import {
  checkPrinterAddress,
  type Lookup,
  PrinterAddressRefusedError,
  PrinterAddressUnreadableError,
  PrinterSchemeRefusedError,
  pinnedUrl,
} from "./printer-address.js";

const lan: Lookup = async () => ["192.168.1.40"];
const check = (address: string, lookup: Lookup = lan) =>
  checkPrinterAddress(address, { env: {}, lookup });

describe("printer address schemes", () => {
  test.each([
    "x://0xa9fea9fe:3030",
    "x://printer.example",
    "ftp://printer.example",
    "file:///etc/passwd",
    "gopher://10.0.0.9:70",
    "javascript://printer.example",
  ])("refuses %s, whatever the name resolves to", async (address) => {
    const err = await check(address).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PrinterSchemeRefusedError);
    expect(String(err)).toContain("Conveyor connects to printers only over http, https, ws, wss");
  });

  test.each([
    "http://0xa9fea9fe",
    "ws://0xa9fea9fe:3030",
    "http://2852039166",
    "https://0251.0376.0251.0376",
    "wss://169.254.169.254",
  ])("reads %s as the metadata address it is, and refuses it", async (address) => {
    await expect(check(address)).rejects.toBeInstanceOf(PrinterAddressRefusedError);
  });

  test.each(["HTTP://10.0.0.9", "Ws://10.0.0.9:3030", "https://10.0.0.9"])(
    "accepts %s, in any case",
    async (address) => {
      await expect(check(address)).resolves.toBe("10.0.0.9");
    },
  );
});

describe("pinnedUrl", () => {
  test("puts the checked IP in a plain http or ws URL and keeps the name for the Host header", () => {
    expect(pinnedUrl("http://printer.lan:7125/moonraker", "10.0.0.9")).toEqual({
      url: "http://10.0.0.9:7125/moonraker",
      host: "printer.lan:7125",
    });
    expect(pinnedUrl("http://printer.lan", "10.0.0.9")).toEqual({
      url: "http://10.0.0.9",
      host: "printer.lan",
    });
    expect(pinnedUrl("ws://printer.lan:3030/websocket", "fd00::1")).toEqual({
      url: "ws://[fd00::1]:3030/websocket",
      host: "printer.lan:3030",
    });
  });

  test("leaves https, wss, an unchecked name and an IP already in the URL as they are", () => {
    for (const url of ["https://printer.lan/x", "wss://printer.lan:3030/websocket"])
      expect(pinnedUrl(url, "10.0.0.9")).toEqual({ url });
    expect(pinnedUrl("http://printer.lan:7125", undefined)).toEqual({
      url: "http://printer.lan:7125",
    });
    expect(pinnedUrl("http://[fd00::1]:80/x", "fd00::1")).toEqual({ url: "http://[fd00::1]:80/x" });
  });
});

describe("addresses the guard can't vouch for", () => {
  const zonedAnswers: string[][] = [
    ["fe80::1%eth0"],
    ["fe80:0:0:0:0:0:0:1%25eth0"],
    ["192.168.1.40", "fe80::1%eth0"],
  ];
  test.each(zonedAnswers.map((answers) => ({ answers })))(
    "refuses a DNS answer carrying a zone id: $answers",
    async ({ answers }) => {
      const zoned: Lookup = async () => answers;
      const err = await check("printer.invalid:7125", zoned).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(PrinterAddressRefusedError);
      expect(String(err)).toContain("an IPv6 address with a zone id");
    },
  );

  test.each([
    ["[fe80::1%25eth0]:7125", "zone"],
    ["fe80::1%eth0", "zone"],
    ["x:printer.example", "port"],
    ["javascript:alert(1)", "port"],
    ["", "empty"],
  ])("refuses %p, which it can't read, naming why (%s)", async (address, why) => {
    const err = await check(address).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PrinterAddressUnreadableError);
    expect(String(err)).toContain("Conveyor can't check this printer address");
    expect(String(err).toLowerCase()).toContain(why);
  });

  test("hides credentials in an unreadable address", async () => {
    const err = await check("admin:secret@x:printer").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PrinterAddressUnreadableError);
    expect(String(err)).not.toContain("secret");
  });

  test("pinnedUrl throws rather than fall back to the name when the IP doesn't take", () => {
    expect(() => pinnedUrl("http://printer.invalid:7125", "fe80::1%eth0")).toThrow(
      "Conveyor couldn't connect to the checked address fe80::1%eth0",
    );
  });
});
