export interface FailureText {
  title: string;
  detail: string;
}

const STEP: Record<string, string> = {
  generator: "Making the model",
  slicer: "Slicing",
  transport: "Sending to the printer",
};

const KNOWN: [RegExp, string][] = [
  [
    /could not fit|outside (the )?(print|bed)|bigger than the bed/i,
    "The model is bigger than the printer's bed. Make it smaller, or pick a bigger printer.",
  ],
  [
    /ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|ENOTFOUND|not reachable|timed out|did not answer/i,
    "Conveyor couldn't reach the printer. Check that it's on and connected, then retry.",
  ],
  [/upload not found/i, "The uploaded file is gone. Upload it again to print it."],
  [
    /printer (is )?busy|already printing/i,
    "The printer was busy with another print. Retry when it's free.",
  ],
];

export function failureText(stage: string, reason: string): FailureText {
  const title = `${STEP[stage] ?? "This job"} didn't finish`;
  const known = KNOWN.find(([pattern]) => pattern.test(reason));
  return {
    title,
    detail: known
      ? known[1]
      : "Something went wrong at this step. Retry, or open Details to see what the server said.",
  };
}
