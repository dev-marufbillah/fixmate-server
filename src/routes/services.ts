import { Router } from "express";
import { Filter, Sort } from "mongodb";
import { serviceCol, userCol } from "../lib/db";
import { ServiceDoc } from "../types";
import { verifyToken, verifyTechnician, AuthedRequest } from "../middlewares/auth";
import { asyncHandler, ok, fail, ApiError, parseId, escapeRegex, requireBody } from "../utils/http";

const router = Router();

export const CATEGORIES = [
  "Smartphone",
  "Laptop & PC",
  "AC",
  "Refrigerator",
  "TV",
  "Washing Machine",
  "Electrical",
] as const;
export const SERVICE_MODES = ["Home Visit", "Shop Drop-off"] as const;

/** GET /api/services — public. All search/filter/sort/pagination happens in MongoDB (Challenge 1). */
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { search, category, serviceMode, sort, page, limit } = req.query as Record<string, string>;

    const filter: Filter<ServiceDoc> = { approvalStatus: "approved", isAvailable: true };

    if (search && search.trim()) {
      const rx = new RegExp(escapeRegex(search.trim()), "i");
      filter.$or = [{ title: rx }, { category: rx }];
    }
    if (category && category !== "All") filter.category = category;
    if (serviceMode && serviceMode !== "All") filter.serviceMode = serviceMode;

    const sortSpec: Sort =
      sort === "price-asc"
        ? { basePrice: 1 }
        : sort === "price-desc"
          ? { basePrice: -1 }
          : { createdAt: -1 };

    const lim = Math.min(Math.max(Number(limit) || 12, 1), 50);
    const pg = Math.max(Number(page) || 1, 1);

    const [services, total] = await Promise.all([
      serviceCol()
        .find(filter)
        .sort(sortSpec)
        .skip((pg - 1) * lim)
        .limit(lim)
        .toArray(),
      serviceCol().countDocuments(filter),
    ]);

    ok(res, { services, total, page: pg, pages: Math.max(Math.ceil(total / lim), 1) });
  })
);

/** GET /api/services/mine — the logged-in technician's own services (any status). */
router.get(
  "/mine",
  verifyTechnician,
  asyncHandler(async (req, res) => {
    const user = (req as AuthedRequest).user;
    const services = await serviceCol()
      .find({ technicianEmail: user.email })
      .sort({ createdAt: -1 })
      .toArray();
    ok(res, { services });
  })
);

/** GET /api/services/:id — public; only approved + available services are visible. */
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const _id = parseId(req.params.id);
    const service = await serviceCol().findOne({
      _id,
      approvalStatus: "approved",
      isAvailable: true,
    });
    if (!service) throw new ApiError(404, "Service not found");

    // Join a light technician profile for the details page (photo, area, bio).
    const tech = await userCol().findOne(
      { email: service.technicianEmail },
      { projection: { name: 1, image: 1, area: 1, bio: 1, email: 1 } }
    );

    ok(res, {
      service,
      technician: tech
        ? {
            name: tech.name,
            image: tech.image || null,
            area: tech.area || "",
            bio: tech.bio || "",
          }
        : { name: service.technicianName, image: null, area: service.serviceArea, bio: "" },
    });
  })
);

/** POST /api/services — technician creates a service (starts as pending). */
router.post(
  "/",
  verifyTechnician,
  asyncHandler(async (req, res) => {
    const user = (req as AuthedRequest).user;
    const body = requireBody(req.body, [
      "title",
      "category",
      "description",
      "basePrice",
      "estimatedDuration",
      "serviceMode",
      "serviceArea",
      "image",
    ]);

    const category = String(body.category);
    const serviceMode = String(body.serviceMode);
    if (!CATEGORIES.includes(category as (typeof CATEGORIES)[number]))
      throw new ApiError(400, "Invalid category");
    if (!SERVICE_MODES.includes(serviceMode as (typeof SERVICE_MODES)[number]))
      throw new ApiError(400, "Invalid service mode");

    const basePrice = Number(body.basePrice);
    if (!Number.isFinite(basePrice) || basePrice <= 0)
      throw new ApiError(400, "Base price must be a positive number");

    const doc: ServiceDoc = {
      title: String(body.title).trim().slice(0, 120),
      category,
      description: String(body.description).trim().slice(0, 3000),
      image: String(body.image).trim(),
      basePrice,
      estimatedDuration: String(body.estimatedDuration).trim().slice(0, 60),
      serviceMode,
      serviceArea: String(body.serviceArea).trim().slice(0, 120),
      technicianName: user.name,
      technicianEmail: user.email,
      approvalStatus: "pending",
      isAvailable: true,
      ratingAvg: 0,
      ratingCount: 0,
      createdAt: new Date(),
    };

    const result = await serviceCol().insertOne(doc);
    ok(res, { service: { ...doc, _id: result.insertedId } }, "Service submitted — waiting for admin approval");
  })
);

/** PATCH /api/services/:id — owner edits; editing resets approval to pending. */
router.patch(
  "/:id",
  verifyTechnician,
  asyncHandler(async (req, res) => {
    const user = (req as AuthedRequest).user;
    const _id = parseId(req.params.id);
    const service = await serviceCol().findOne({ _id });
    if (!service) throw new ApiError(404, "Service not found");
    if (service.technicianEmail !== user.email) throw new ApiError(403, "You can only edit your own services");

    const b = (req.body || {}) as Record<string, unknown>;
    const updates: Record<string, unknown> = {};

    if (b.title !== undefined) updates.title = String(b.title).trim().slice(0, 120);
    if (b.category !== undefined) {
      if (!CATEGORIES.includes(b.category as (typeof CATEGORIES)[number])) throw new ApiError(400, "Invalid category");
      updates.category = b.category;
    }
    if (b.description !== undefined) updates.description = String(b.description).trim().slice(0, 3000);
    if (b.image !== undefined) updates.image = String(b.image).trim();
    if (b.basePrice !== undefined) {
      const p = Number(b.basePrice);
      if (!Number.isFinite(p) || p <= 0) throw new ApiError(400, "Base price must be a positive number");
      updates.basePrice = p;
    }
    if (b.estimatedDuration !== undefined) updates.estimatedDuration = String(b.estimatedDuration).trim().slice(0, 60);
    if (b.serviceMode !== undefined) {
      if (!SERVICE_MODES.includes(b.serviceMode as (typeof SERVICE_MODES)[number]))
        throw new ApiError(400, "Invalid service mode");
      updates.serviceMode = b.serviceMode;
    }
    if (b.serviceArea !== undefined) updates.serviceArea = String(b.serviceArea).trim().slice(0, 120);

    if (Object.keys(updates).length === 0) throw new ApiError(400, "Nothing to update");

    // Editing a service requires a fresh admin approval.
    updates.approvalStatus = "pending";

    await serviceCol().updateOne({ _id }, { $set: updates });
    const updated = await serviceCol().findOne({ _id });
    ok(res, { service: updated }, "Service updated — waiting for admin approval");
  })
);

/** PATCH /api/services/:id/availability — owner toggles visibility on public pages. */
router.patch(
  "/:id/availability",
  verifyTechnician,
  asyncHandler(async (req, res) => {
    const user = (req as AuthedRequest).user;
    const _id = parseId(req.params.id);
    const service = await serviceCol().findOne({ _id });
    if (!service) throw new ApiError(404, "Service not found");
    if (service.technicianEmail !== user.email) throw new ApiError(403, "You can only change your own services");

    const isAvailable = (req.body as { isAvailable?: unknown })?.isAvailable;
    if (typeof isAvailable !== "boolean") throw new ApiError(400, "isAvailable must be a boolean");

    await serviceCol().updateOne({ _id }, { $set: { isAvailable } });
    ok(res, { isAvailable }, isAvailable ? "Service is now available" : "Service hidden from public pages");
  })
);

/** DELETE /api/services/:id — owner deletes with server-side ownership check. */
router.delete(
  "/:id",
  verifyTechnician,
  asyncHandler(async (req, res) => {
    const user = (req as AuthedRequest).user;
    const _id = parseId(req.params.id);
    const service = await serviceCol().findOne({ _id });
    if (!service) throw new ApiError(404, "Service not found");
    if (service.technicianEmail !== user.email) throw new ApiError(403, "You can only delete your own services");
    await serviceCol().deleteOne({ _id });
    ok(res, { deleted: true }, "Service deleted");
  })
);

export default router;
