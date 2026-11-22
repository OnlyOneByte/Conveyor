import { randomBytes } from "node:crypto";
import { connect } from "node:net";

export async function silentClient(base: string, path: string): Promise<{ closed: Promise<void> }> {
  const { hostname, port } = new URL(base);
  const socket = connect(Number(port), hostname);
  const closed = new Promise<void>((resolve) => socket.on("close", () => resolve()));
  await new Promise<void>((resolve, reject) => {
    socket.once("error", reject);
    socket.once("data", (chunk) =>
      String(chunk).startsWith("HTTP/1.1 101") ? resolve() : reject(new Error(String(chunk))),
    );
    socket.write(
      [
        `GET ${path} HTTP/1.1`,
        `Host: ${hostname}:${port}`,
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Key: ${randomBytes(16).toString("base64")}`,
        "Sec-WebSocket-Version: 13",
        "",
        "",
      ].join("\r\n"),
    );
  });
  return { closed };
}
