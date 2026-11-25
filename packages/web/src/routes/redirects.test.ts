import { describe, expect, test } from "bun:test";
import { load as history } from "./history/+page";
import { load as historyJob } from "./history/[jobId]/+page";
import { load as monitor } from "./monitor/+page";

const target = (run: () => unknown) => {
  try {
    run();
  } catch (thrown) {
    return thrown;
  }
  return null;
};

describe("old URLs", () => {
  test.each([
    ["/monitor", () => monitor(), "/jobs"],
    ["/history", () => history(), "/jobs"],
    ["/history/a b", () => historyJob({ params: { jobId: "a b" } }), "/jobs/a%20b"],
  ])("%s moves for good to its new page", (_, run, location) => {
    expect(target(run)).toMatchObject({ status: 308, location });
  });
});
