import { expect, test } from "bun:test";
import type { JobHistoryEntry } from "./api";
import { retryRow, settledRow } from "./jobs-list";
import type { Retried } from "./retry";

const at = Date.UTC(2026, 10, 24, 15, 0);
const failed: JobHistoryEntry = {
  id: "f1",
  request: { generator: { id: "gridfinity", params: {} }, printerId: "voron", profileId: "p" },
  state: "failed",
  createdAt: at,
  updatedAt: at,
};
const hold = "Voron is on hold. Check it, then choose Release hold on the Printers page.";

test("R on a failed job whose printer is held says why, not 'already being retried'", async () => {
  const refused: Retried = { ok: false, status: 409, error: hold, held: true };
  const [text, level] = await retryRow(settledRow(failed, null, at), async () => refused);
  expect(level).toBe("assertive");
  expect(text).toEndWith(`: ${hold}`);
  expect(text).not.toContain("already being retried");
});
