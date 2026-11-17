import dotenv from "dotenv";

dotenv.config();

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
