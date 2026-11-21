export const MIN_SECRET_LENGTH = 32;

export type AuthConfig =
  | { enabled: true; password: string; secret: string }
  | { enabled: false; password: ""; secret: string };

export class AuthConfigError extends Error {
  override name = "AuthConfigError";
}

type Env = Record<string, string | undefined>;

const SETUP_HINT = "See docs/self-hosting.md for first-run setup.";

export const DISABLED_WARNING =
  "[auth] CONVEYOR_AUTH=disabled: authentication is OFF. Anyone who can reach this API can start prints and change printer settings. Use this only on a network you fully trust.";

export function resolveAuthConfig(env: Env, randomSecret: () => string): AuthConfig {
  const mode = env.CONVEYOR_AUTH ?? "";
  if (mode === "disabled") return { enabled: false, password: "", secret: randomSecret() };
  if (mode !== "" && mode !== "enabled") {
    throw new AuthConfigError(
      `[auth] CONVEYOR_AUTH must be "enabled" or "disabled", got "${mode}". ${SETUP_HINT}`,
    );
  }
  const password = env.CONVEYOR_PASSWORD ?? "";
  const secret = env.CONVEYOR_AUTH_SECRET ?? "";
  const missing = [
    password ? null : "CONVEYOR_PASSWORD",
    secret ? null : "CONVEYOR_AUTH_SECRET",
  ].filter((name) => name !== null);
  if (missing.length > 0) {
    throw new AuthConfigError(
      `[auth] refusing to start: ${missing.join(" and ")} not set. Set both in .env, or set CONVEYOR_AUTH=disabled to run without a login. ${SETUP_HINT}`,
    );
  }
  if (secret.length < MIN_SECRET_LENGTH) {
    throw new AuthConfigError(
      `[auth] refusing to start: CONVEYOR_AUTH_SECRET must be at least ${MIN_SECRET_LENGTH} characters (try \`openssl rand -hex 32\`). ${SETUP_HINT}`,
    );
  }
  return { enabled: true, password, secret };
}
