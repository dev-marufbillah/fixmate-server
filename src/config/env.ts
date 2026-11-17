import fs from "fs";
import path from "path";

// Tiny .env loader (no dotenv dependency) — local dev reads .env;
// Vercel/production supplies real environment variables.
try {
  const envPath = path.join(process.cwd(), ".env");
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  }
} catch {
  /* no .env — use process.env as-is */
}

function str(name: string, fallback: string): string {
  return (process.env[name] || fallback).trim();
}

export const env = {
  port: Number(str("PORT", "5000")),
  nodeEnv: str("NODE_ENV", "development"),
  mongoUri: str("MONGODB_URI", "mongodb://127.0.0.1:27017/fixmate"),
  jwtSecret: str("JWT_SECRET", "dev-only-secret-change-me"),
  clientUrl: str("CLIENT_URL", "http://localhost:3000"),
  corsOrigins: str("CORS_ORIGINS", "http://localhost:3000")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
  stripeSecretKey: str("STRIPE_SECRET_KEY", ""),
  stripeWebhookSecret: str("STRIPE_WEBHOOK_SECRET", ""),
  imgbbApiKey: str("IMGBB_API_KEY", ""),
};
