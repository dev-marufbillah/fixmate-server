import { Router } from "express";
import multer from "multer";
import { verifyToken } from "../middlewares/auth";
import { env } from "../config/env";
import { asyncHandler, ok, ApiError } from "../utils/http";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 },
});

/**
 * POST /api/upload/imgbb — authenticated multipart upload (field: "image").
 * The ImgBB key stays on the server (.env), never in the browser bundle.
 */
router.post(
  "/imgbb",
  verifyToken,
  upload.single("image"),
  asyncHandler(async (req, res) => {
    if (!env.imgbbApiKey || env.imgbbApiKey === "placeholder")
      throw new ApiError(500, "ImgBB API key is not configured on the server");
    if (!req.file) throw new ApiError(400, "No image file provided (field name must be 'image')");
    if (req.file.size > 4 * 1024 * 1024) throw new ApiError(400, "Image must be smaller than 4MB");

    const base64 = req.file.buffer.toString("base64");
    const form = new FormData();
    form.append("image", base64);

    const response = await fetch(`https://api.imgbb.com/1/upload?key=${env.imgbbApiKey}`, {
      method: "POST",
      body: form,
    });
    const json = (await response.json()) as {
      success?: boolean;
      data?: { url?: string; display_url?: string; thumb?: { url?: string } };
      error?: { message?: string };
    };

    if (!response.ok || !json.success || !json.data?.url) {
      throw new ApiError(502, json.error?.message || "ImgBB upload failed");
    }

    ok(res, { url: json.data.url, displayUrl: json.data.display_url || json.data.url }, "Image uploaded");
  })
);

export default router;
