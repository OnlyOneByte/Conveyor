interface FailureText {
  title: string;
  detail: string;
}

const STEP = new Map([
  ["generator", "Making the model"],
  ["slicer", "Slicing"],
  ["transport", "Sending to the printer"],
]);

const KNOWN: [RegExp, string][] = [
  [
    /fully inside the print volume|partly inside, can not be sliced|outside of the print volume/i,
    "The model doesn't fit the printer's bed. Make it smaller, or pick a bigger printer.",
  ],
  [
    /printer is on hold/i,
    "The printer is on hold until someone checks it. Check the printer, then choose Release hold on the Printers page and retry.",
  ],
  [
    /printer is busy/i,
    "The printer is busy with another print. Wait for it to finish, then retry.",
  ],
  [
    /printer reports an error/i,
    "The printer reports an error. Clear it on the printer, then retry.",
  ],
  [
    /idle check|printer state unknown/i,
    "Conveyor couldn't check that the printer is free, so it didn't send the job. Check that the printer is on and connected, then retry.",
  ],
  [
    /no answer to print start/i,
    "The printer didn't answer the print start, so it may have started. Conveyor has put it on hold: check it, then choose Release hold on the Printers page before you retry.",
  ],
  [
    /Unable to connect|timed out|WS error to/i,
    "Conveyor couldn't reach the printer. Check that it's on and connected, then retry.",
  ],
  [/upload not found/i, "The uploaded file is gone. Upload it again to print it."],
];

export function failureText(stage: string, reason: string): FailureText {
  const title = `${STEP.get(stage) ?? "This job"} didn't finish`;
  const known = KNOWN.find(([pattern]) => pattern.test(reason));
  return {
    title,
    detail: known
      ? known[1]
      : "Something went wrong at this step. Retry, or open Details to see what Conveyor said.",
  };
}
