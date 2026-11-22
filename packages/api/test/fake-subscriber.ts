import type { StatusSubscriber } from "../src/status-hub.ts";

export class FakeSubscriber implements StatusSubscriber {
  readonly calls: string[] = [];
  failSubscribe = false;
  private message: (channel: string, payload: string) => void = () => {};
  error: (error: Error) => void = () => {};

  async subscribe(channel: string) {
    this.calls.push(`subscribe ${channel}`);
    if (this.failSubscribe) throw new Error("subscribe refused");
  }
  async unsubscribe(channel: string) {
    this.calls.push(`unsubscribe ${channel}`);
  }
  on(event: "message" | "error", listener: (...args: never[]) => void) {
    if (event === "message") this.message = listener as typeof this.message;
    else this.error = listener as typeof this.error;
    return this;
  }
  async quit() {
    this.calls.push("quit");
  }
  emit(channel: string, payload: string) {
    this.message(channel, payload);
  }
}
