import { Router, Request, Response } from "express";
import Stripe from "stripe";
import { bookingCol, paymentCol, ObjectId } from "../lib/db";
import { stripe } from "../lib/stripe";
import { env } from "../config/env";
import { PaymentDoc } from "../types";
import { verifyToken, verifyCustomer, AuthedRequest } from "../middlewares/auth";
import { asyncHandler, ok, ApiError, parseId } from "../utils/http";

const router = Router();

/**
 * Idempotent payment save shared by the success-page verify API and the
 * Stripe webhook — the same payment can never be stored twice (Challenge 4).
 */
async function persistPayment(session: Stripe.Checkout.Session) {
  const existing = await paymentCol().findOne({ stripeSessionId: session.id });
  const bookingId = session.metadata?.bookingId || "";
  const booking =
    bookingId && ObjectId.isValid(bookingId)
      ? await bookingCol().findOne({ _id: new ObjectId(bookingId) })
      : null;

  const markBookingPaid = async () => {
    if (booking && booking.paymentStatus !== "paid") {
      await bookingCol().updateOne(
        { _id: booking._id },
        {
          $set: { paymentStatus: "paid" },
          $push: { statusHistory: { status: "paid", changedAt: new Date() } },
        }
      );
    }
  };

  if (existing) {
    await markBookingPaid();
    return { saved: false, payment: existing };
  }

  if (session.payment_status !== "paid") throw new ApiError(402, "Payment not completed");

  const doc: PaymentDoc = {
    bookingId,
    serviceTitle: booking?.serviceTitle || "FixMate repair service",
    customerName: booking?.customerName || session.customer_details?.name || "",
    customerEmail: session.metadata?.customerEmail || booking?.customerEmail || "",
    technicianName: booking?.technicianName || "",
    technicianEmail: booking?.technicianEmail || "",
    amount: (session.amount_total ?? 0) / 100,
    currency: session.currency || "usd",
    transactionId: String(session.payment_intent || session.id),
    stripeSessionId: session.id,
    paymentStatus: "paid",
    paidAt: new Date(),
  };

  try {
    await paymentCol().insertOne(doc);
  } catch (err) {
    // Unique index on stripeSessionId → another request saved it first.
    if ((err as { code?: number })?.code === 11000) {
      await markBookingPaid();
      return { saved: false, payment: await paymentCol().findOne({ stripeSessionId: session.id }) };
    }
    throw err;
  }

  await markBookingPaid();
  return { saved: true, payment: doc };
}

/**
 * POST /api/payments/create-checkout-session — customer pays a completed, unpaid job.
 * The amount is ALWAYS read from the database, never from the client.
 */
router.post(
  "/create-checkout-session",
  verifyCustomer,
  asyncHandler(async (req, res) => {
    const user = (req as AuthedRequest).user;
    const bookingId = parseId((req.body as { bookingId?: unknown })?.bookingId);

    const booking = await bookingCol().findOne({ _id: bookingId });
    if (!booking) throw new ApiError(404, "Booking not found");
    if (booking.customerEmail !== user.email)
      throw new ApiError(403, "You can only pay for your own bookings");
    if (booking.status !== "completed") throw new ApiError(422, "Payment is allowed only for completed jobs");
    if (booking.paymentStatus === "paid") throw new ApiError(409, "This job is already paid");

    const amount = Number(booking.finalAmount || booking.basePrice);
    if (!Number.isFinite(amount) || amount <= 0) throw new ApiError(422, "Invalid job amount");

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: Math.round(amount * 100),
            product_data: { name: booking.serviceTitle },
          },
          quantity: 1,
        },
      ],
      success_url: `${env.clientUrl}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${env.clientUrl}/payment/cancel`,
      metadata: { bookingId: String(bookingId), customerEmail: booking.customerEmail },
      customer_email: booking.customerEmail,
    });

    ok(res, { url: session.url }, "Checkout session created");
  })
);

/**
 * GET /api/payments/verify?session_id=... — success-page verification.
 * Saves the payment once; repeats return the same record.
 */
router.get(
  "/verify",
  verifyToken,
  asyncHandler(async (req, res) => {
    const user = (req as AuthedRequest).user;
    const sessionId = String(req.query.session_id || "");
    if (!sessionId) throw new ApiError(400, "session_id is required");

    let session: Stripe.Checkout.Session;
    try {
      session = await stripe.checkout.sessions.retrieve(sessionId);
    } catch {
      throw new ApiError(404, "Checkout session not found");
    }

    const ownerEmail = session.metadata?.customerEmail;
    if (ownerEmail && ownerEmail !== user.email)
      throw new ApiError(403, "This payment does not belong to you");
    if (session.payment_status !== "paid") throw new ApiError(402, "Payment not completed yet");

    const { payment } = await persistPayment(session);
    ok(res, {
      amount: (session.amount_total ?? 0) / 100,
      transactionId: String(session.payment_intent || session.id),
      bookingId: session.metadata?.bookingId || "",
      serviceTitle: payment?.serviceTitle || "",
      currency: session.currency || "usd",
    }, "Payment verified");
  })
);

/** Stripe webhook (Challenge 4) — raw body + signature, same idempotent save. */
export const webhookHandler = async (req: Request, res: Response) => {
  try {
    if (!env.stripeWebhookSecret) throw new Error("STRIPE_WEBHOOK_SECRET is not configured");
    const event = stripe.webhooks.constructEvent(
      req.body as Buffer,
      String(req.headers["stripe-signature"] || ""),
      env.stripeWebhookSecret
    );
    if (event.type === "checkout.session.completed") {
      await persistPayment(event.data.object as Stripe.Checkout.Session);
    }
    res.json({ received: true });
  } catch (err) {
    console.error("[stripe-webhook]", err);
    res.status(400).json({ success: false, message: `Webhook error: ${(err as Error).message}` });
  }
};

/** GET /api/payments/my — customer payment history. */
router.get(
  "/my",
  verifyCustomer,
  asyncHandler(async (req, res) => {
    const user = (req as AuthedRequest).user;
    const payments = await paymentCol()
      .find({ customerEmail: user.email })
      .sort({ paidAt: -1 })
      .toArray();
    const totalSpent = payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
    ok(res, { payments, totalSpent });
  })
);

export default router;
