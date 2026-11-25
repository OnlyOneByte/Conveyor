const HEADER = 84;
const FACET = 50;

const binary = (buf: Buffer) =>
  buf.byteLength >= HEADER && buf.byteLength === HEADER + FACET * buf.readUInt32LE(80);

const ascii = (buf: Buffer) => {
  const text = buf.subarray(0, 4096).toString("latin1").trimStart();
  return text.startsWith("solid") && /\bfacet\b/.test(text);
};

export const looksLikeStl = (buf: Buffer) => binary(buf) || ascii(buf);

export function readFailure(error: unknown): 400 | 413 | null {
  if (error instanceof Error && "code" in error && error.code === "FST_REQ_FILE_TOO_LARGE")
    return 413;
  return error instanceof Error && error.constructor === Error ? 400 : null;
}
