import { spyOn } from "bun:test";

const { preconnect } = globalThis.fetch;
export const fetchSpy = spyOn(globalThis, "fetch");

export const within = <T>(promise: Promise<T>, ms: number) =>
  Promise.race([
    promise,
    new Promise<never>((_resolve, reject) =>
      setTimeout(() => reject(new Error(`no answer within ${ms} ms`)), ms),
    ),
  ]);

export function fakeFetch(respond: (url: string, init?: RequestInit) => Promise<Response>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return respond(String(url), init);
  };
  fetchSpy.mockImplementation(Object.assign(impl, { preconnect }));
  return calls;
}
