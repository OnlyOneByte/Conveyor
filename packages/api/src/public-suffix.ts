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

const PRIVATE_LABELS = new Set(["internal", "lan", "local"]);

const SHARED_ZONES = new Set([
  "afraid.org",
  "appspot.com",
  "azurewebsites.net",
  "blogspot.com",
  "cloudfront.net",
  "cn.com",
  "ddns.me",
  "ddns.net",
  "duckdns.org",
  "dyndns.org",
  "dynv6.net",
  "eu.org",
  "firebaseapp.com",
  "fly.dev",
  "freeddns.org",
  "gb.net",
  "github.dev",
  "github.io",
  "gitlab.io",
  "glitch.me",
  "herokuapp.com",
  "hopto.org",
  "k12.ca.us",
  "lhr.life",
  "loca.lt",
  "localhost.run",
  "mooo.com",
  "myftp.org",
  "netlify.app",
  "ngrok-free.app",
  "ngrok.app",
  "ngrok.dev",
  "ngrok.io",
  "nip.io",
  "no-ip.org",
  "nom.br",
  "onrender.com",
  "pages.dev",
  "pp.ua",
  "repl.co",
  "s3.amazonaws.com",
  "servehttp.com",
  "serveo.net",
  "sslip.io",
  "trycloudflare.com",
  "ts.net",
  "uk.com",
  "us.to",
  "vercel.app",
  "web.app",
  "workers.dev",
  "zapto.org",
]);

export function isPublicSuffix(suffix: string): boolean {
  const labels = suffix.split(".");
  if (labels.length === 1) return !PRIVATE_LABELS.has(suffix);
  const [second = "", top = ""] = labels.length === 2 ? labels : [];
  if (top.length === 2 && SECOND_LEVEL.has(second)) return true;
  return SHARED_ZONES.has(suffix);
}
