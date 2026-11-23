export interface StatusSubscriber {
  subscribe(channel: string): Promise<unknown>;
  unsubscribe(channel: string): Promise<unknown>;
  on(event: "message", listener: (channel: string, payload: string) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  quit(): Promise<unknown>;
}

export type StatusListener = (payload: string) => void;

export interface StatusHub {
  watch(channel: string, listener: StatusListener): Promise<() => void>;
  connections(): number;
}

export function createStatusHub(
  connect: () => StatusSubscriber,
  onError: (error: Error) => void,
): StatusHub {
  const channels = new Map<string, { listeners: Set<StatusListener>; ready: Promise<unknown> }>();
  let subscriber: StatusSubscriber | undefined;

  const open = (): StatusSubscriber => {
    if (subscriber) return subscriber;
    const created = connect();
    created.on("message", (channel, payload) => {
      for (const listener of channels.get(channel)?.listeners ?? []) listener(payload);
    });
    created.on("error", onError);
    subscriber = created;
    return created;
  };

  const leave = (channel: string, listener: StatusListener) => {
    const entry = channels.get(channel);
    if (!entry?.listeners.delete(listener) || entry.listeners.size > 0) return;
    channels.delete(channel);
    const current = subscriber;
    if (!current) return;
    if (channels.size === 0) {
      subscriber = undefined;
      current.quit().catch(onError);
    } else {
      current.unsubscribe(channel).catch(onError);
    }
  };

  return {
    async watch(channel, listener) {
      const sub = open();
      let entry = channels.get(channel);
      if (!entry) {
        entry = { listeners: new Set(), ready: sub.subscribe(channel) };
        channels.set(channel, entry);
      }
      entry.listeners.add(listener);
      try {
        await entry.ready;
      } catch (error) {
        leave(channel, listener);
        throw error;
      }
      let watching = true;
      return () => {
        if (!watching) return;
        watching = false;
        leave(channel, listener);
      };
    },
    connections: () => (subscriber ? 1 : 0),
  };
}
