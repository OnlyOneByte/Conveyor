import http from "node:http";
import net from "node:net";

type Listen = (...args: unknown[]) => unknown;

function pinHost(proto: { listen: Listen }): void {
  const original = proto.listen;
  proto.listen = function (this: unknown, ...args: unknown[]) {
    const [first] = args;
    if (first && typeof first === "object") {
      args[0] = { ...(first as object), host: "127.0.0.1" };
    } else if (typeof first === "number") {
      const rest = args.slice(1);
      const hasHost = typeof rest[0] === "string";
      args = [first, "127.0.0.1", ...(hasHost ? rest.slice(1) : rest)];
    }
    return original.apply(this, args);
  };
}

pinHost(net.Server.prototype as unknown as { listen: Listen });
if (http.Server.prototype.listen !== net.Server.prototype.listen) {
  pinHost(http.Server.prototype as unknown as { listen: Listen });
}
