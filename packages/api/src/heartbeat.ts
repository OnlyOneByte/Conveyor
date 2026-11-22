export interface Heartbeat {
  intervalMs: number;
  missed: number;
}

export const DEFAULT_HEARTBEAT: Heartbeat = { intervalMs: 30_000, missed: 2 };

export interface PingableSocket {
  ping(): void;
  terminate(): void;
  on(event: "pong" | "close", listener: () => void): unknown;
}

export function keepAlive(socket: PingableSocket, heartbeat: Heartbeat): void {
  let unanswered = 0;
  const timer = setInterval(() => {
    if (unanswered >= heartbeat.missed) return socket.terminate();
    unanswered++;
    socket.ping();
  }, heartbeat.intervalMs);
  socket.on("pong", () => {
    unanswered = 0;
  });
  socket.on("close", () => clearInterval(timer));
}
