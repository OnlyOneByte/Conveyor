import { describe, expect, test } from "bun:test";
import {
  checkPrinterAddress,
  isLoopbackHost,
  type Lookup,
  loopbackPrinters,
  PrinterAddressRefusedError,
  printerHost,
  requirePrinterAddress,
} from "./printer-address.js";

const answers =
  (...ips: string[][]): Lookup =>
  async () =>
    ips.shift() ?? [];
const lan: Lookup = async () => ["192.168.1.40"];
const check = (address: string, lookup: Lookup = lan, allow?: string) =>
  checkPrinterAddress(address, { env: { PRINTER_ADDRESS_ALLOW: allow }, lookup });

describe("printer addresses a self-hosted printer uses", () => {
  test.each([
    "192.168.1.50:7125",
    "10.0.0.9",
    "172.16.4.2:3030",
    "[fd00::12]:3030",
    "voron.local",
    "http://voron.local:7125",
    "https://printer.example.com/moonraker",
    "//10.0.0.9/moonraker",
    "user:pass@10.0.0.9/moonraker",
    "localhost:7125",
    "127.0.0.1",
    "[::1]:7125",
  ])("allows %s", async (address) => {
    await expect(check(address)).resolves.toBeUndefined();
  });
});

describe("link-local and cloud metadata addresses", () => {
  test.each([
    ["169.254.169.254", "169.254.169.254"],
    ["http://169.254.169.254/latest/meta-data", "169.254.169.254"],
    ["user:pass@169.254.169.254/x", "169.254.169.254"],
    ["[fe80::1]:3030", "fe80::1"],
    ["[::ffff:169.254.169.254]", "::ffff:a9fe:a9fe"],
    ["0xA9FEA9FE", "169.254.169.254"],
    ["2852039166:7125", "169.254.169.254"],
    ["user:pass@0251.0376.0251.0376/moonraker", "169.254.169.254"],
    ["//169.254.169.254./x", "169.254.169.254"],
    ["[fd20:ce::254]", "fd20:ce::254"],
    ["[64:ff9b::169.254.169.254]", "64:ff9b::a9fe:a9fe"],
    ["[::169.254.169.254]", "::a9fe:a9fe"],
    ["[fd00:ec2::254]", "fd00:ec2::254"],
    ["100.100.100.200", "100.100.100.200"],
    ["metadata.google.internal", "metadata.google.internal"],
    ["http://Metadata.Google.Internal./computeMetadata/v1", "metadata.google.internal"],
  ])("refuses %s", async (address, host) => {
    const refused = await check(address).catch((err: unknown) => err);
    expect(refused).toBeInstanceOf(PrinterAddressRefusedError);
    expect(String(refused)).toContain(`Conveyor won't connect to ${host}`);
    expect(String(refused)).toContain("PRINTER_ADDRESS_ALLOW");
  });

  test("refuses a name that resolves to a metadata address, not only the literal", async () => {
    await expect(check("printer.example", answers(["169.254.169.254"]))).rejects.toThrow(
      "it is a link-local address, where cloud metadata services listen (169.254.169.254)",
    );
    await expect(check("printer.example", answers(["10.0.0.5", "fe80::7"]))).rejects.toThrow(
      PrinterAddressRefusedError,
    );
  });

  test("a name that passed once is refused when it later resolves to metadata (DNS rebinding)", async () => {
    const rebinding = answers(["192.168.1.40"], ["169.254.169.254"]);
    await expect(check("printer.example", rebinding)).resolves.toBeUndefined();
    await expect(check("printer.example", rebinding)).rejects.toThrow(PrinterAddressRefusedError);
  });

  test("a name that doesn't resolve, or resolves to nothing, is refused", async () => {
    const failing: Lookup = async () => {
      throw new Error("ENOTFOUND");
    };
    await expect(check("voron.local", failing)).rejects.toThrow(
      "Conveyor won't connect to voron.local: it is a name Conveyor couldn't resolve",
    );
    await expect(check("voron.local", answers([]))).rejects.toThrow(PrinterAddressRefusedError);
    await expect(check("voron.local", failing, "voron.local")).resolves.toBeUndefined();
  });

  test("NAT64 and IPv4-compatible forms of an allowed address stay allowed", async () => {
    await expect(check("[64:ff9b::192.168.1.5]")).resolves.toBeUndefined();
    await expect(check("[::10.0.0.9]")).resolves.toBeUndefined();
  });
});

describe("PRINTER_ADDRESS_ALLOW", () => {
  test("lets a CIDR, a single address or a host through a refused range", async () => {
    await expect(check("169.254.10.5", lan, "169.254.10.0/24")).resolves.toBeUndefined();
    await expect(check("[fe80::1]:3030", lan, "fe80::1")).resolves.toBeUndefined();
    await expect(
      check("printer.example", answers(["169.254.3.3"]), "printer.example"),
    ).resolves.toBeUndefined();
    await expect(check("169.254.11.5", lan, "169.254.10.0/24")).rejects.toThrow(
      PrinterAddressRefusedError,
    );
  });

  test("an entry that isn't a CIDR fails with the setting's name", async () => {
    await expect(check("10.0.0.9", lan, "10.0.0.0/99")).rejects.toThrow(
      "PRINTER_ADDRESS_ALLOW: 10.0.0.0/99 is not a valid CIDR",
    );
    await expect(check("10.0.0.9", lan, "printer.example/24")).rejects.toThrow(
      "PRINTER_ADDRESS_ALLOW: printer.example/24 is not a valid CIDR",
    );
  });
});

test("the host is read from every address form, and loopback is recognised", () => {
  expect(printerHost("user:pass@10.0.0.9/moonraker")).toBe("10.0.0.9");
  expect(printerHost("//[fe80::1]:3030/x")).toBe("fe80::1");
  expect(printerHost("http://u:p@Voron.Local:7125/")).toBe("voron.local");
  expect(printerHost("not a host")).toBeUndefined();
  expect(["localhost", "127.0.0.5", "::1", "printer.localhost"].map(isLoopbackHost)).toEqual([
    true,
    true,
    true,
    true,
  ]);
  expect(isLoopbackHost("10.0.0.9")).toBe(false);
});

test("the printers to log once at startup are the ones on loopback", () => {
  expect(
    loopbackPrinters([
      { id: "proxy", address: "http://localhost:7125" },
      { id: "garage", address: "192.168.1.50" },
      { id: "local", address: "[::1]:3030" },
    ]),
  ).toEqual(["proxy", "local"]);
});

test("a transport sees a refusal or a bad PRINTER_ADDRESS_ALLOW as a transport-stage failure", async () => {
  const options = { env: { PRINTER_ADDRESS_ALLOW: "10.0.0.0/99" }, lookup: lan };
  await expect(requirePrinterAddress("10.0.0.9", options)).rejects.toMatchObject({
    stage: "transport",
    reason: "PRINTER_ADDRESS_ALLOW: 10.0.0.0/99 is not a valid CIDR",
  });
  await expect(requirePrinterAddress("169.254.169.254", { lookup: lan })).rejects.toMatchObject({
    stage: "transport",
  });
});
