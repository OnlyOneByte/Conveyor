const HEADER = 84;
const FACET = 50;

const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

const triangles = (buf: Buffer) => (buf.byteLength >= HEADER ? buf.readUInt32LE(80) : 0);

const binary = (buf: Buffer) =>
  triangles(buf) > 0 && buf.byteLength === HEADER + FACET * triangles(buf);

const ascii = (buf: Buffer) => {
  const body = buf.subarray(0, BOM.byteLength).equals(BOM) ? buf.subarray(BOM.byteLength) : buf;
  const text = body.subarray(0, 4096).toString("latin1").trimStart();
  return text.startsWith("solid") && /\bfacet\b/.test(text);
};

export const looksLikeStl = (buf: Buffer) => binary(buf) || ascii(buf);

export function readFailure(error: unknown): 400 | 413 | null {
  if (error instanceof Error && "code" in error && error.code === "FST_REQ_FILE_TOO_LARGE")
    return 413;
  return error instanceof Error && error.constructor === Error ? 400 : null;
}
