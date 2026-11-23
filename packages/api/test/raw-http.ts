import { connect } from "node:net";

export interface RawResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export function rawGet(port: number, path: string): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const socket = connect(port, "127.0.0.1", () =>
      socket.write(`GET ${path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`),
    );
    let raw = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      raw += chunk;
    });
    socket.on("error", reject);
    socket.on("end", () => {
      const [head = "", body = ""] = raw.split("\r\n\r\n");
      const [statusLine = "", ...lines] = head.split("\r\n");
      const headers = Object.fromEntries(
        lines.map((line) => {
          const at = line.indexOf(":");
          return [line.slice(0, at).toLowerCase(), line.slice(at + 1).trim()];
        }),
      );
      resolve({ status: Number(statusLine.split(" ")[1]), headers, body });
    });
  });
}
