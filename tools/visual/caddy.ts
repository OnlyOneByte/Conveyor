export const CADDY_IMAGE = "caddy:2";

export interface CaddyPorts {
  port: number;
  apiPort: number;
  webPort: number;
}

const rewrite = (source: string, from: string, to: string): string => {
  const at = source.indexOf(from);
  if (at < 0 || source.indexOf(from, at + 1) >= 0)
    throw new Error(`Caddyfile changed shape: expected exactly one "${from}"`);
  return source.replace(from, to);
};

export function visualCaddyfile(source: string, ports: CaddyPorts): string {
  const steps: [string, string][] = [
    ["skip_install_trust", "skip_install_trust\n\tadmin off"],
    ["{$CONVEYOR_DOMAIN:localhost} {", `http://127.0.0.1:${ports.port} {\n\tbind 127.0.0.1`],
    ["reverse_proxy api:3000", `reverse_proxy 127.0.0.1:${ports.apiPort}`],
    ["reverse_proxy web:3000", `reverse_proxy 127.0.0.1:${ports.webPort}`],
  ];
  return steps.reduce((text, [from, to]) => rewrite(text, from, to), source);
}

export const caddyRun = (file: string): string[] => [
  "docker",
  "run",
  "-d",
  "--rm",
  "--network",
  "host",
  "-v",
  `${file}:/etc/caddy/Caddyfile:ro`,
  CADDY_IMAGE,
];
