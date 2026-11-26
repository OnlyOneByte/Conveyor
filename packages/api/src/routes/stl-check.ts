const HEADER = 84;
const FACET = 50;
const ASCII_WINDOW = 4096;

const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

export const HEAD_BYTES = BOM.byteLength + ASCII_WINDOW;

const triangles = (head: Buffer) => (head.byteLength >= HEADER ? head.readUInt32LE(80) : 0);

const binary = (head: Buffer, size: number) =>
  triangles(head) > 0 && size === HEADER + FACET * triangles(head);

const ascii = (head: Buffer) => {
  const body = head.subarray(0, BOM.byteLength).equals(BOM) ? head.subarray(BOM.byteLength) : head;
  const text = body.subarray(0, ASCII_WINDOW).toString("latin1").trimStart();
  return text.startsWith("solid") && /\bfacet\b/.test(text);
};

export const looksLikeStl = (head: Buffer, size: number = head.byteLength) =>
  binary(head, size) || ascii(head);

export function readFailure(error: unknown): 400 | 413 | null {
  if (error instanceof Error && "code" in error && error.code === "FST_REQ_FILE_TOO_LARGE")
    return 413;
  return error instanceof Error && error.constructor === Error ? 400 : null;
}
