import { describe, expect, test } from "bun:test";
import { type JobState, StageError } from "@conveyor/shared";
import { readJobPayload } from "./job-payload";
import type { PublishExtra } from "./run";

function recorder() {
  const published: { jobId: string; state: JobState; extra?: PublishExtra }[] = [];
  const publish = async (jobId: string, state: JobState, extra?: PublishExtra) => {
    published.push({ jobId, state, extra });
  };
  return { published, publish };
}

describe("readJobPayload", () => {
  test("a well-formed payload comes back as the job request and publishes nothing", async () => {
    const { published, publish } = recorder();
    const payload = {
      generator: { id: "gen", params: { x: 1 } },
      printerId: "p1",
      profileId: "pr",
    };
    expect(await readJobPayload("job-1", payload, publish)).toEqual(payload);
    expect(published).toEqual([]);
  });

  test("a payload missing the printer publishes a failed status and rejects", async () => {
    const { published, publish } = recorder();
    const payload = { generator: { id: "gen" }, profileId: "pr" };
    const result = readJobPayload("job-1", payload, publish);
    await expect(result).rejects.toThrow(StageError);
    await expect(result).rejects.toThrow("invalid job payload");
    expect(published).toHaveLength(1);
    expect(published[0]?.jobId).toBe("job-1");
    expect(published[0]?.state).toBe("failed");
    expect(published[0]?.extra?.error?.stage).toBe("generator");
    expect(published[0]?.extra?.error?.reason).toContain("printerId");
  });
});
