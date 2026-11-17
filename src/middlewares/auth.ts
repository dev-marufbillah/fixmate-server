import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";

export type Role = "customer" | "technician" | "admin";

export interface AuthUser {
  sub: string;
  email: string;
  name: string;
  role: Role;
  image?: string | null;
}

export interface AuthedRequest extends Request {
  user: AuthUser;
}

function readToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header && header.startsWith("Bearer ")) return header.slice(7).trim();
  return null;
}

function authenticate(req: Request): AuthUser | null {
  const token = readToken(req);
  if (!token) return null;
  try {
    const payload = jwt.verify(token, env.jwtSecret) as AuthUser;
    if (!payload?.email || !payload?.sub) return null;
    return payload;
  } catch {
    return null;
  }
}

/** 401 without a valid JWT — Challenge 2. */
export function verifyToken(req: Request, res: Response, next: NextFunction) {
  const user = authenticate(req);
  if (!user) {
    return res.status(401).json({ success: false, message: "Unauthorized: missing or invalid token" });
  }
  (req as AuthedRequest).user = user;
  return next();
}

function requireRole(...roles: Role[]) {
  // Standalone: verifies the token itself (401) and then the role (403),
  // so it works alone or after an explicit verifyToken.
  return (req: Request, res: Response, next: NextFunction) => {
    const user = authenticate(req);
    if (!user) {
      return res.status(401).json({ success: false, message: "Unauthorized: missing or invalid token" });
    }
    (req as AuthedRequest).user = user;
    if (!roles.includes(user.role)) {
      return res.status(403).json({ success: false, message: `Forbidden: requires role ${roles.join(" or ")}` });
    }
    return next();
  };
}

/** 403 for authenticated users with the wrong role — Challenge 2. */
export const verifyCustomer = requireRole("customer");
export const verifyTechnician = requireRole("technician");
export const verifyAdmin = requireRole("admin");
