import type { PrintProgress, PrintStatus } from "@conveyor/shared";

export const STANDBY_POLLS = 3;

export const STANDBY_ENDED =
  "the printer went back to standby before reporting how the print ended; check the printer";

export interface Poll {
  state: string;
  progress: number;
  message?: string;
  print?: PrintProgress;
}

export interface Step {
  status?: PrintStatus;
  final: boolean;
}

export function printWatch(): (poll: Poll) => Step {
  let printingSeen = false;
  let standbyPolls = 0;
  return ({ state, progress, message, print }) => {
    if (state !== "standby") standbyPolls = 0;
    switch (state) {
      case "printing":
        printingSeen = true;
        return { status: { state: "printing", progress, message, print }, final: false };
      case "paused":
        return { status: { state: "printing", progress, message: "paused", print }, final: false };
      case "complete":
        return { status: { state: "done", progress: 1 }, final: true };
      case "cancelled":
        return {
          status: { state: "canceled", message: "print cancelled on printer" },
          final: true,
        };
      case "error":
        return {
          status: { state: "failed", message: message ?? "printer reported an error" },
          final: true,
        };
      case "standby":
        if (!printingSeen) return { final: false };
        if (progress >= 0.999) return { status: { state: "done", progress: 1 }, final: true };
        standbyPolls++;
        if (standbyPolls < STANDBY_POLLS) return { final: false };
        return { status: { state: "failed", message: STANDBY_ENDED }, final: true };
      default:
        return { final: false };
    }
  };
}
