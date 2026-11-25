import { stlGeometry } from "./stl-geometry.js";

self.onmessage = async (event: MessageEvent<File>) => {
  const buffer = await event.data.arrayBuffer().catch(() => null);
  const parsed = buffer ? stlGeometry(buffer) : null;
  if (!parsed) return self.postMessage(null);
  self.postMessage(parsed, { transfer: [parsed.position.buffer, parsed.normal.buffer] });
};
