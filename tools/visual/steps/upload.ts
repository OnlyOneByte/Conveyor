import { type StepRunner, wrongKind } from "../step.ts";

declare module "../step.ts" {
  interface StepKinds {
    upload: { upload: string; name: string; text: string };
  }
}

export const step: StepRunner = {
  kind: "upload",
  run: async (page, step) => {
    if (!("upload" in step)) throw wrongKind("upload", step);
    await page.setInputFiles(step.upload, {
      name: step.name,
      mimeType: "application/octet-stream",
      buffer: Buffer.from(step.text),
    });
  },
};
