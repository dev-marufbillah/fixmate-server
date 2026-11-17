import express, { Request, Response } from "express";
import cors from "cors";
import { env } from "./config/env";
import { fail, errorHandler } from "./utils/http";
import servicesRouter from "./routes/services";
import bookingsRouter from "./routes/bookings";
import paymentsRouter, { webhookHandler } from "./routes/payments";
import adminRouter from "./routes/admin";
import usersRouter from "./routes/users";
import uploadRouter from "./routes/upload";

const app = express();

// CORS — production domains live in CORS_ORIGINS (.env)
const allowedOrigins = new Set([...env.corsOrigins, env.clientUrl]);
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) return callback(null, true);
      return callback(null, false);
    },
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Stripe webhook needs the raw body for signature verification (Challenge 4).
app.post("/api/payments/webhook", express.raw({ type: "application/json" }), webhookHandler);

app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req: Request, res: Response) =>
  res.json({ success: true, message: "FixMate API is running", data: { time: new Date().toISOString() } })
);

app.use("/api/services", servicesRouter);
app.use("/api/bookings", bookingsRouter);
app.use("/api/payments", paymentsRouter);
app.use("/api/admin", adminRouter);
app.use("/api/users", usersRouter);
app.use("/api/upload", uploadRouter);

app.use((_req: Request, res: Response) => fail(res, 404, "API route not found"));
app.use(errorHandler);

export default app;
