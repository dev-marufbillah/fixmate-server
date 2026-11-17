import { Request, Response, NextFunction, RequestHandler } from "express";
import { ObjectId } from "mongodb";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

export const ok = (res: Response, data: unknown, message = "OK") =>
  res.json({ success: true, message, data });

export const fail = (res: Response, status: number, message: string) =>
  res.status(status).json({ success: false, message });

export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

export function parseId(value: unknown): ObjectId {
  const id = String(value || "");
  if (!ObjectId.isValid(id)) throw new ApiError(400, "Invalid id");
  return new ObjectId(id);
}

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function requireBody<T extends Record<string, unknown>>(
  body: unknown,
  fields: string[]
): T {
  const b = (body || {}) as Record<string, unknown>;
  for (const f of fields) {
    const v = b[f];
    if (v === undefined || v === null || String(v).trim() === "") {
      throw new ApiError(400, `Field "${f}" is required`);
    }
  }
  return b as T;
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ApiError) return fail(res, err.status, err.message);
  const message = err instanceof Error ? err.message : "Internal server error";
  // Mongo duplicate key (payment saved twice) → treat as conflict
  if ((err as { code?: number })?.code === 11000) return fail(res, 409, "Duplicate record");
  console.error("[fixmate-server]", err);
  return fail(res, 500, message);
}
