import app from "./app";
import { env } from "./config/env";
import { ensureIndexes, getDb } from "./lib/db";

async function main() {
  try {
    await getDb().command({ ping: 1 });
    await ensureIndexes();
    console.log("✅ MongoDB connected + indexes ready");
  } catch (err) {
    console.error("⚠️  MongoDB connection failed — check MONGODB_URI in .env");
    console.error("   ", (err as Error).message);
  }

  app.listen(env.port, "0.0.0.0", () => {
    console.log(`🚀 FixMate API listening on http://0.0.0.0:${env.port}`);
    console.log(`   CORS origins: ${[...env.corsOrigins, env.clientUrl].join(", ")}`);
  });
}

main();
