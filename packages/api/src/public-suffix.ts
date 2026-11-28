const SECOND_LEVEL = new Set([
  "ac",
  "co",
  "com",
  "edu",
  "go",
  "gov",
  "ltd",
  "ne",
  "net",
  "or",
  "org",
  "plc",
]);

const SHARED_ZONES = new Set([
  "afraid.org",
  "appspot.com",
  "azurewebsites.net",
  "cloudfront.net",
  "ddns.net",
  "duckdns.org",
  "dyndns.org",
  "firebaseapp.com",
  "fly.dev",
  "github.io",
  "gitlab.io",
  "herokuapp.com",
  "hopto.org",
  "loca.lt",
  "netlify.app",
  "ngrok-free.app",
  "ngrok.io",
  "nip.io",
  "no-ip.org",
  "onrender.com",
  "pages.dev",
  "sslip.io",
  "trycloudflare.com",
  "ts.net",
  "vercel.app",
  "web.app",
  "workers.dev",
  "zapto.org",
]);

export function isPublicSuffix(suffix: string): boolean {
  const labels = suffix.split(".");
  if (labels.length === 1) return true;
  const [second = "", top = ""] = labels.length === 2 ? labels : [];
  if (top.length === 2 && SECOND_LEVEL.has(second)) return true;
  return SHARED_ZONES.has(suffix);
}
