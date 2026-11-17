import { Router } from "express";
import { userCol, serviceCol, bookingCol, paymentCol } from "../lib/db";
import { verifyToken, verifyAdmin, AuthedRequest } from "../middlewares/auth";
import { asyncHandler, ok, ApiError, parseId } from "../utils/http";
import { UserDoc, ServiceDoc } from "../types";

const router = Router();
router.use(verifyToken, verifyAdmin);

const ROLES = ["customer", "technician", "admin"];

/** GET /api/admin/users */
router.get(
  "/users",
  asyncHandler(async (_req, res) => {
    const users = await userCol()
      .find({}, { projection: { name: 1, email: 1, image: 1, role: 1, createdAt: 1, phone: 1, area: 1 } })
      .sort({ createdAt: -1 })
      .toArray();
    ok(res, { users });
  })
);

/** PATCH /api/admin/users/:id/role — an admin cannot change their own role. */
router.patch(
  "/users/:id/role",
  asyncHandler(async (req, res) => {
    const admin = (req as AuthedRequest).user;
    const _id = parseId(req.params.id);
    const role = String((req.body as { role?: unknown })?.role || "");
    if (!ROLES.includes(role)) throw new ApiError(400, "Invalid role");
    if (String(_id) === admin.sub) throw new ApiError(403, "You cannot change your own role");

    const result = await userCol().updateOne({ _id }, { $set: { role: role as UserDoc["role"] } });
    if (result.matchedCount === 0) throw new ApiError(404, "User not found");

    const updated = await userCol().findOne({ _id }, { projection: { name: 1, email: 1, role: 1, image: 1 } });
    ok(res, { user: updated }, `Role updated to ${role}`);
  })
);

/** PATCH /api/admin/services/:id/approval — approve or reject a listing. */
router.patch(
  "/services/:id/approval",
  asyncHandler(async (req, res) => {
    const _id = parseId(req.params.id);
    const status = String((req.body as { status?: unknown })?.status || "");
    if (!["approved", "rejected"].includes(status)) throw new ApiError(400, "Status must be approved or rejected");

    const result = await serviceCol().updateOne(
      { _id },
      { $set: { approvalStatus: status as ServiceDoc["approvalStatus"] } }
    );
    if (result.matchedCount === 0) throw new ApiError(404, "Service not found");

    ok(res, { approvalStatus: status }, `Service ${status}`);
  })
);

/** GET /api/admin/bookings — read-only, filterable by status. */
router.get(
  "/bookings",
  asyncHandler(async (req, res) => {
    const filter: Record<string, unknown> = {};
    const status = String(req.query.status || "");
    if (status) filter.status = status;
    const bookings = await bookingCol().find(filter).sort({ createdAt: -1 }).limit(500).toArray();
    ok(res, { bookings });
  })
);

/** GET /api/admin/payments — every transaction + total revenue. */
router.get(
  "/payments",
  asyncHandler(async (_req, res) => {
    const [payments, agg] = await Promise.all([
      paymentCol().find({}).sort({ paidAt: -1 }).limit(500).toArray(),
      paymentCol().aggregate([{ $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } }]).toArray(),
    ]);
    ok(res, {
      payments,
      totalRevenue: agg[0]?.total || 0,
      totalTransactions: agg[0]?.count || 0,
    });
  })
);

/** GET /api/admin/stats — overview cards + charts. */
router.get(
  "/stats",
  asyncHandler(async (_req, res) => {
    const [totalUsers, totalTechnicians, totalBookings, pendingServices, revenueAgg, byStatus] =
      await Promise.all([
        userCol().countDocuments(),
        userCol().countDocuments({ role: "technician" }),
        bookingCol().countDocuments(),
        serviceCol().countDocuments({ approvalStatus: "pending" }),
        paymentCol().aggregate([{ $group: { _id: null, total: { $sum: "$amount" } } }]).toArray(),
        bookingCol().aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]).toArray(),
      ]);

    ok(res, {
      totalUsers,
      totalTechnicians,
      totalBookings,
      pendingServices,
      totalRevenue: revenueAgg[0]?.total || 0,
      byStatus,
    });
  })
);

/** GET /api/admin/services — all listings, filterable (pending first). */
router.get(
  "/services",
  asyncHandler(async (req, res) => {
    const filter: Record<string, unknown> = {};
    const status = String(req.query.status || "");
    if (status) filter.approvalStatus = status;
    const services = await serviceCol()
      .find(filter)
      .sort({ approvalStatus: 1, createdAt: -1 })
      .toArray();
    ok(res, { services });
  })
);

export default router;
