import { type StepRunner, wrongKind } from "../step.ts";

interface Shown {
  ownerDocument: {
    defaultView: {
      getComputedStyle(el: Shown): { display: string; listStyleType: string };
    } | null;
  };
}

declare module "../step.ts" {
  interface StepKinds {
    marker: { marker: string };
  }
}

export const step: StepRunner = {
  kind: "marker",
  run: async (page, step) => {
    if (!("marker" in step)) throw wrongKind("marker", step);
    const targets = page.locator(step.marker);
    await targets.first().waitFor({ timeout: 5000 });
    const styles = await targets.evaluateAll((els: Shown[]) =>
      els.map((el) => {
        const style = el.ownerDocument.defaultView?.getComputedStyle(el);
        return { display: style?.display ?? "", list: style?.listStyleType ?? "" };
      }),
    );
    const bare = styles.filter(({ display, list }) => display !== "list-item" || list === "none");
    if (bare.length)
      throw new Error(
        `${step.marker}: ${bare.length} of ${styles.length} show no disclosure marker (${bare
          .map(({ display, list }) => `display ${display}, list-style ${list}`)
          .join("; ")})`,
      );
  },
};
