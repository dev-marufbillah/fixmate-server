import { MongoClient, Db, Collection, ObjectId } from "mongodb";
import { env } from "../config/env";
import { UserDoc, ServiceDoc, BookingDoc, PaymentDoc } from "../types";

let client: MongoClient | null = null;
let db: Db | null = null;

/** Lazy Mongo connection — the driver connects on the first operation. */
export function getDb(): Db {
  if (!db) {
    client = new MongoClient(env.mongoUri);
    db = client.db();
  }
  return db;
}

// BetterAuth owns the "user" collection — we treat it as our users collection.
export const userCol = (): Collection<UserDoc> => getDb().collection<UserDoc>("user");
export const serviceCol = (): Collection<ServiceDoc> => getDb().collection<ServiceDoc>("services");
export const bookingCol = (): Collection<BookingDoc> => getDb().collection<BookingDoc>("bookings");
export const paymentCol = (): Collection<PaymentDoc> => getDb().collection<PaymentDoc>("payments");

/** Create the indexes that power search, filters and payment idempotency. */
export async function ensureIndexes(): Promise<void> {
  await Promise.all([
    serviceCol().createIndex({ approvalStatus: 1, isAvailable: 1, createdAt: -1 }),
    serviceCol().createIndex({ technicianEmail: 1 }),
    serviceCol().createIndex({ title: "text", category: "text" }),
    bookingCol().createIndex({ customerEmail: 1, serviceId: 1, status: 1 }),
    bookingCol().createIndex({ technicianEmail: 1, status: 1 }),
    bookingCol().createIndex({ createdAt: -1 }),
    paymentCol().createIndex({ stripeSessionId: 1 }, { unique: true }),
    paymentCol().createIndex({ customerEmail: 1, paidAt: -1 }),
    paymentCol().createIndex({ bookingId: 1 }),
    // The users collection (owned by BetterAuth) gets its own email index from the adapter.
  ]);
}

export { ObjectId };
