import { spyOn } from "bun:test";
import { printerDns } from "../../src/node/printer-address.ts";

export interface PrinterDnsStub {
  asked: string[];
  restore: () => void;
}

export function stubPrinterDns(...answers: string[][]): PrinterDnsStub {
  const asked: string[] = [];
  const spy = spyOn(printerDns, "resolve").mockImplementation(async (host: string) => {
    asked.push(host);
    return answers.length > 1 ? (answers.shift() ?? []) : (answers[0] ?? []);
  });
  return { asked, restore: () => spy.mockRestore() };
}

export interface HeldPrinterDns {
  answer: () => void;
  restore: () => void;
}

export function holdPrinterDns(ips: string[]): HeldPrinterDns {
  let answer = () => {};
  const answered = new Promise<void>((resolve) => {
    answer = resolve;
  });
  const spy = spyOn(printerDns, "resolve").mockImplementation(async () => {
    await answered;
    return ips;
  });
  return { answer, restore: () => spy.mockRestore() };
}
