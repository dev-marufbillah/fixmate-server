import { Router } from "express";
import { userCol } from "../lib/db";
import { verifyToken, AuthedRequest } from "../middlewares/auth";
import { asyncHandler, ok, ApiError } from "../utils/http";

const router = Router();

/** PATCH /api/users/profile — update name, phone, area, bio, photo (email & role are read-only). */
router.patch(
  "/profile",
  verifyToken,
  asyncHandler(async (req, res) => {
    const user = (req as AuthedRequest).user;
    const b = (req.body || {}) as Record<string, unknown>;
    const updates: Record<string, unknown> = {};

    if (b.name !== undefined) {
      const name = String(b.name).trim();
      if (name.length < 2 || name.length > 80) throw new ApiError(400, "Name must be 2-80 characters");
      updates.name = name;
    }
    if (b.phone !== undefined) updates.phone = String(b.phone).trim().slice(0, 30);
    if (b.area !== undefined) updates.area = String(b.area).trim().slice(0, 120);
    if (b.bio !== undefined) updates.bio = String(b.bio).trim().slice(0, 600);
    if (b.image !== undefined) updates.image = String(b.image).trim().slice(0, 1000);

    if (Object.keys(updates).length === 0) throw new ApiError(400, "No valid fields to update");

    const result = await userCol().updateOne({ email: user.email }, { $set: updates });
    if (result.matchedCount === 0) throw new ApiError(404, "User not found");

    const updated = await userCol().findOne(
      { email: user.email },
      { projection: { name: 1, email: 1, image: 1, role: 1, phone: 1, area: 1, bio: 1 } }
    );
    ok(res, { user: updated }, "Profile updated");
  })
);

export default router;
