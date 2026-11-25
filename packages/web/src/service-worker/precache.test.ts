import { describe, expect, test } from "bun:test";
import { precached } from "./precache";

const kept = [
  "_app/immutable/entry/start.Dua2OphI.js",
  "_app/immutable/chunks/DTMqFl5l.js",
  "_app/immutable/nodes/2.BFnsYAFX.js",
  "_app/immutable/assets/0.GrN5nUvP.css",
  "_app/immutable/assets/bricolage-grotesque-latin-wght-normal.DLoelf7F.woff2",
  "_app/immutable/assets/dm-mono-latin-500-normal.DRMDZjhP.woff2",
  "favicon.svg",
  "/manifest.webmanifest",
];

const dropped = [
  "_app/immutable/assets/basis_transcoder.VXdx5NbI.wasm",
  "_app/immutable/assets/basis_transcoder.o4Hde_L7.js",
  "_app/immutable/assets/draco_decoder.fzg4nYZr.js",
  "_app/immutable/assets/draco_wasm_wrapper.DxJM36Ib.js",
  "_app/immutable/assets/dm-mono-latin-400-normal.-0xN8mdc.woff",
  "_app/immutable/assets/dm-mono-latin-ext-500-normal.BtRyHRi6.woff2",
  "_app/immutable/assets/bricolage-grotesque-vietnamese-wght-normal.BUzh504Q.woff2",
  "_app/immutable/assets/inter-cyrillic-ext-400-normal.abc.woff2",
  "_app/immutable/assets/inter-greek-400-normal.abc.woff2",
];

describe("the service-worker precache", () => {
  test("keeps the app's code, styles, Latin fonts and static files, as absolute paths", () => {
    expect(precached(kept)).toEqual(kept.map((path) => (path.startsWith("/") ? path : `/${path}`)));
  });

  test("leaves out decoders, wasm, legacy woff fonts and non-Latin subsets", () => {
    expect(precached(dropped)).toEqual([]);
  });

  test("leaves out the chunks the build marks as on demand, such as the profile editor", () => {
    const paths = ["_app/immutable/chunks/a.js", "_app/immutable/chunks/editor.js"];
    const kept = precached(paths, ["/_app/immutable/chunks/editor.js"]);
    expect(kept).toEqual(["/_app/immutable/chunks/a.js"]);
  });
});
