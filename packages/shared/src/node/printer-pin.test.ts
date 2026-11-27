import { describe, expect, test } from "bun:test";
import {
  checkPrinterAddress,
  type Lookup,
  PrinterAddressRefusedError,
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
