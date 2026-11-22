import { expect, test } from "bun:test";
import { harness } from "./pipeline-harness";

test("a job whose printer or profile was deleted fails before generating anything", async () => {
  const h = harness({ deps: () => ({ resolveJobTarget: () => null }) });
  await expect(h.run()).rejects.toThrow("[generator] unknown printer p1 or profile prof");
  expect(h.generated).toBe(0);
  expect(h.records.at(-1)).toMatchObject({
    state: "failed",
    reason: "unknown printer p1 or profile prof",
  });
});
