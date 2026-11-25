import { stlSize } from "./stl-size.js";

self.onmessage = async (event: MessageEvent<File>) => {
  const buffer = await event.data.arrayBuffer().catch(() => null);
  self.postMessage(buffer ? stlSize(buffer) : null);
};
