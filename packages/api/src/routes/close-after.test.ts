import { expect, test } from "bun:test";
import { SMALL_BODY_BYTES, sendsUploadBody } from "./close-after.js";

test.each([
  [
    "a multipart upload",
    { "content-type": "Multipart/Form-Data; boundary=B", "content-length": "10" },
    true,
  ],
  ["a chunked body", { "transfer-encoding": "chunked" }, true],
  ["a body over the small-body size", { "content-length": String(SMALL_BODY_BYTES + 1) }, true],
  ["a small JSON body", { "content-type": "application/json", "content-length": "2" }, false],
  ["a body of exactly the small-body size", { "content-length": String(SMALL_BODY_BYTES) }, false],
  ["no body", {}, false],
])("%s counts as an upload body: %p", (_name, headers, expected) => {
  expect(sendsUploadBody({ headers })).toBe(expected);
});
