import { Router } from "express";
import { bookingCol, serviceCol, ObjectId } from "../lib/db";
import { verifyCustomer, verifyTechnician, AuthedRequest } from "../middlewares/auth";
import { asyncHandler, ok, ApiError, parseId, requireBody } from "../utils/http";
import { BookingDoc } from "../types";

const router = Router();

const ACTIVE_STATUSES = ["requested", "accepted", "in-progress"] as const;
const ALL_STATUSES: string[] = [...ACTIVE_STATUSES, "completed", "rejected", "cancelled"];

/** Server-enforced job status pipeline (Challenge 3). */
const TRANSITIONS: Record<string, string[]> = {
  requested: ["accepted", "rejected"],
  accepted: ["in-progress"],
  "in-progress": ["completed"],
};

function pushHistory(booking: BookingDoc, status: string) {
  return [...(booking.statusHistory || []), { status, changedAt: new Date() }];
}

/**
 * POST /api/bookings — customer sends a repair request.
 * Rules enforced here: customers only, not your own service, no duplicate active request.
 */
router.post(
  "/",
  verifyCustomer,
  asyncHandler(async (req, res) => {
    const user = (req as AuthedRequest).user;
    const body = requireBody(req.body, ["serviceId", "phone", "address", "preferredDate", "problemDescription"]);

    const serviceId = parseId(body.serviceId);
    const problem = String(body.problemDescription).trim();
    if (problem.length < 20) throw new ApiError(400, "Problem description must be at least 20 characters");

    const preferred = new Date(String(body.preferredDate));
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (isNaN(preferred.getTime()) || preferred < today)
      throw new ApiError(400, "Preferred date must be today or a future date");

    const service = await serviceCol().findOne({
      _id: serviceId,
      approvalStatus: "approved",
      isAvailable: true,
    });
    if (!service) throw new ApiError(404, "Service not found");
    if (service.technicianEmail === user.email)
      throw new ApiError(403, "You cannot request a repair for your own service");

    const duplicate = await bookingCol().findOne({
      customerEmail: user.email,
      serviceId: String(serviceId),
      status: { $in: ACTIVE_STATUSES },
    });
    if (duplicate)
      throw new ApiError(409, "You already have an active request for this service");

    const doc: BookingDoc = {
      serviceId: String(serviceId),
      serviceTitle: service.title,
      serviceImage: service.image,
      category: service.category,
      basePrice: service.basePrice,
      finalAmount: service.basePrice,
      technicianName: service.technicianName,
      technicianEmail: service.technicianEmail,
      customerName: user.name,
      customerEmail: user.email,
      customerPhone: String(body.phone).trim().slice(0, 30),
      address: String(body.address).trim().slice(0, 300),
      preferredDate: preferred,
      problemDescription: problem.slice(0, 2000),
      status: "requested",
      paymentStatus: "unpaid",
      statusHistory: [{ status: "requested", changedAt: new Date() }],
      createdAt: new Date(),
    };

    const result = await bookingCol().insertOne(doc);
    ok(res, { booking: { ...doc, _id: result.insertedId } }, "Repair request sent");
  })
);

/** GET /api/bookings/my — customer's own bookings (identity comes ONLY from the JWT). */
router.get(
  "/my",
  verifyCustomer,
  asyncHandler(async (req, res) => {
    const user = (req as AuthedRequest).user;
    const filter: Record<string, unknown> = { customerEmail: user.email };
    const status = String(req.query.status || "");
    if (status && ALL_STATUSES.includes(status)) filter.status = status;
    const bookings = await bookingCol().find(filter).sort({ createdAt: -1 }).toArray();
    ok(res, { bookings });
  })
);

/** GET /api/bookings/customer/stats — customer overview cards + chart. */
router.get(
  "/customer/stats",
  verifyCustomer,
  asyncHandler(async (req, res) => {
    const user = (req as AuthedRequest).user;
    const match = { customerEmail: user.email };
    const [total, active, completed, byStatus] = await Promise.all([
      bookingCol().countDocuments(match),
      bookingCol().countDocuments({ ...match, status: { $in: ACTIVE_STATUSES } }),
      bookingCol().countDocuments({ ...match, status: "completed" }),
      bookingCol().aggregate([{ $match: match }, { $group: { _id: "$status", count: { $sum: 1 } } }]).toArray(),
    ]);
    ok(res, { total, active, completed, byStatus });
  })
);

/** PATCH /api/bookings/:id/cancel — customer cancels, only while status is "requested". */
router.patch(
  "/:id/cancel",
  verifyCustomer,
  asyncHandler(async (req, res) => {
    const user = (req as AuthedRequest).user;
    const _id = parseId(req.params.id);
    const booking = await bookingCol().findOne({ _id });
    if (!booking) throw new ApiError(404, "Booking not found");
    if (booking.customerEmail !== user.email) throw new ApiError(403, "You can only cancel your own bookings");
    if (booking.status !== "requested")
      throw new ApiError(422, "Only jobs that are still requested can be cancelled");

    await bookingCol().updateOne(
      { _id },
      { $set: { status: "cancelled", statusHistory: pushHistory(booking, "cancelled") } }
    );
    ok(res, { status: "cancelled" }, "Booking cancelled");
  })
);

/** GET /api/bookings/technician — incoming requests for the logged-in technician. */
router.get(
  "/technician",
  verifyTechnician,
  asyncHandler(async (req, res) => {
    const user = (req as AuthedRequest).user;
    const filter: Record<string, unknown> = { technicianEmail: user.email };
    const status = String(req.query.status || "");
    if (status && ALL_STATUSES.includes(status)) filter.status = status;
    const bookings = await bookingCol().find(filter).sort({ createdAt: -1 }).toArray();
    ok(res, { bookings });
  })
);

/** GET /api/bookings/technician/stats — technician overview cards + chart. */
router.get(
  "/technician/stats",
  verifyTechnician,
  asyncHandler(async (req, res) => {
    const user = (req as AuthedRequest).user;
    const svc = { technicianEmail: user.email };
    const match = { technicianEmail: user.email };
    const [totalServices, approvedServices, pendingRequests, byStatus] = await Promise.all([
      serviceCol().countDocuments(svc),
      serviceCol().countDocuments({ ...svc, approvalStatus: "approved" }),
      bookingCol().countDocuments({ ...match, status: "requested" }),
      bookingCol().aggregate([{ $match: match }, { $group: { _id: "$status", count: { $sum: 1 } } }]).toArray(),
    ]);
    ok(res, { totalServices, approvedServices, pendingRequests, byStatus });
  })
);

/**
 * PATCH /api/bookings/:id/status — technician moves the job forward (Challenge 3).
 * Only the owning technician; only valid transitions; "completed" requires finalAmount > 0.
 */
router.patch(
  "/:id/status",
  verifyTechnician,
  asyncHandler(async (req, res) => {
    const user = (req as AuthedRequest).user;
    const _id = parseId(req.params.id);
    const booking = await bookingCol().findOne({ _id });
    if (!booking) throw new ApiError(404, "Booking not found");
    if (booking.technicianEmail !== user.email)
      throw new ApiError(403, "You can only update jobs assigned to you");

    const next = String((req.body as { status?: unknown })?.status || "").toLowerCase();
    const allowed = TRANSITIONS[booking.status] || [];
    if (!allowed.includes(next))
      throw new ApiError(422, `Cannot move job from "${booking.status}" to "${next}"`);

    const update: Record<string, unknown> = {
      status: next,
      statusHistory: pushHistory(booking, next),
    };

    if (next === "completed") {
      const amount = Number((req.body as { finalAmount?: unknown })?.finalAmount);
      if (!Number.isFinite(amount) || amount <= 0)
        throw new ApiError(400, "Final amount must be a number greater than 0");
      update.finalAmount = Math.round(amount * 100) / 100;
    }

    await bookingCol().updateOne({ _id }, { $set: update });
    const updated = await bookingCol().findOne({ _id });
    ok(res, { booking: updated }, `Job status updated to ${next}`);
  })
);

/**
 * POST /api/bookings/:id/review — optional rating & review after the job is paid.
 */
router.post(
  "/:id/review",
  verifyCustomer,
  asyncHandler(async (req, res) => {
    const user = (req as AuthedRequest).user;
    const _id = parseId(req.params.id);
    const booking = await bookingCol().findOne({ _id });
    if (!booking) throw new ApiError(404, "Booking not found");
    if (booking.customerEmail !== user.email) throw new ApiError(403, "You can only review your own bookings");
    if (booking.paymentStatus !== "paid") throw new ApiError(422, "You can rate a job only after payment");
    if (booking.rating) throw new ApiError(409, "You have already rated this job");

    const rating = Math.min(5, Math.max(1, Math.round(Number((req.body as { rating?: unknown })?.rating))));
    if (!rating || Number.isNaN(rating)) throw new ApiError(400, "Rating must be between 1 and 5");
    const review = String((req.body as { review?: unknown })?.review || "").trim().slice(0, 500);

    await bookingCol().updateOne({ _id }, { $set: { rating, review } });

    // Denormalize the average onto the service card.
    const serviceId = booking.serviceId;
    if (ObjectId.isValid(serviceId)) {
      const agg = await bookingCol()
        .aggregate([
          { $match: { serviceId, rating: { $ne: null } } },
          { $group: { _id: null, avg: { $avg: "$rating" }, count: { $sum: 1 } } },
        ])
        .toArray();
      if (agg[0]) {
        await serviceCol().updateOne(
          { _id: new ObjectId(serviceId) },
          { $set: { ratingAvg: Math.round(agg[0].avg * 10) / 10, ratingCount: agg[0].count } }
        );
      }
    }

    ok(res, { rating, review }, "Thanks for your feedback");
  })
);

export default router;
