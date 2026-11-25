export const CADDY_IMAGE = "caddy:2";

export interface CaddyPorts {
  port: number;
  apiPort: number;
  webPort: number;
}

type Run = (cmd: string[]) => { exitCode: number | null; stdout: Buffer; stderr: Buffer };

const rewrite = (source: string, from: string, to: string): string => {
  const at = source.indexOf(from);
  if (at < 0 || source.indexOf(from, at + 1) >= 0)
    throw new Error(`Caddyfile changed shape: expected exactly one "${from}"`);
  return source.replace(from, to);
};

export function visualCaddyfile(source: string, ports: CaddyPorts): string {
  const steps: [string, string][] = [
    ["skip_install_trust", "skip_install_trust\n\tadmin off\n\tauto_https off"],
    ["{$CONVEYOR_DOMAIN:localhost} {", `http://127.0.0.1:${ports.port} {\n\tbind 127.0.0.1`],
    ["reverse_proxy api:3000", `reverse_proxy 127.0.0.1:${ports.apiPort}`],
    ["reverse_proxy web:3000", `reverse_proxy 127.0.0.1:${ports.webPort}`],
  ];
  return steps.reduce((text, [from, to]) => rewrite(text, from, to), source);
}

const entries = (value: unknown): [string, unknown][] =>
  typeof value === "object" && value !== null ? Object.entries(value) : [];
const field = (value: unknown, key: string): unknown =>
  entries(value).find(([name]) => name === key)?.[1];
const unexpected = (value: unknown, allowed: string[], what: string): string[] =>
  entries(value)
    .map(([name]) => name)
    .filter((name) => !allowed.includes(name))
    .map((name) => `${what} "${name}"`);
const dials = (value: unknown): string[] =>
  entries(value).flatMap(([name, inner]) =>
    name === "dial" && typeof inner === "string" ? [inner] : dials(inner),
  );

export function adaptedProblem(config: unknown, ports: CaddyPorts): string | null {
  const admin = field(config, "admin");
  const apps = field(config, "apps");
  const http = field(apps, "http");
  const servers = entries(field(http, "servers"));
  const listen = JSON.stringify([`127.0.0.1:${ports.port}`]);
  const upstreams = [`127.0.0.1:${ports.apiPort}`, `127.0.0.1:${ports.webPort}`];
  const problems = [
    ...unexpected(config, ["admin", "apps"], "top-level"),
    ...unexpected(apps, ["http"], "app"),
    ...unexpected(http, ["servers"], "http option"),
    ...(field(admin, "disabled") === true && entries(admin).length === 1
      ? []
      : ["the admin API isn't disabled"]),
    ...(servers.length === 1 ? [] : [`${servers.length} servers, not 1`]),
    ...servers.flatMap(([name, server]) => [
      ...unexpected(server, ["listen", "routes", "automatic_https"], `server ${name} option`),
      ...(JSON.stringify(field(server, "listen")) === listen
        ? []
        : [`server ${name} listens on ${JSON.stringify(field(server, "listen"))}`]),
      ...(field(field(server, "automatic_https"), "disable") === true
        ? []
        : [`server ${name} keeps automatic HTTPS`]),
    ]),
    ...dials(config)
      .filter((dial) => !upstreams.includes(dial))
      .map((dial) => `an upstream at ${dial}`),
  ];
  return problems.length > 0
    ? `the visual Caddy config isn't loopback-only: ${problems.join("; ")}`
    : null;
}

export const caddyAdapt = (file: string): string[] => [
  "docker",
  "run",
  "--rm",
  "--network",
  "none",
  "-v",
  `${file}:/etc/caddy/Caddyfile:ro`,
  CADDY_IMAGE,
  "caddy",
  "adapt",
  "--config",
  "/etc/caddy/Caddyfile",
];

export function assertLoopbackCaddy(run: Run, file: string, ports: CaddyPorts): void {
  const adapted = run(caddyAdapt(file));
  if (adapted.exitCode !== 0)
    throw new Error(`caddy adapt failed: ${adapted.stderr.toString().trim()}`);
  const problem = adaptedProblem(JSON.parse(adapted.stdout.toString()), ports);
  if (problem) throw new Error(problem);
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
