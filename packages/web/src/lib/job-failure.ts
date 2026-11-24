export interface FailureText {
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
      : "Something went wrong at this step. Retry, or open Details to see what the server said.",
  };
}
