import { ObjectId } from "mongodb";

export interface StatusEvent {
  status: string;
  changedAt: Date;
}

export interface ServiceDoc {
  _id?: ObjectId;
  title: string;
  category: string;
  description: string;
  image: string;
  basePrice: number;
  estimatedDuration: string;
  serviceMode: string;
  serviceArea: string;
  technicianName: string;
  technicianEmail: string;
  approvalStatus: "pending" | "approved" | "rejected";
  isAvailable: boolean;
  ratingAvg?: number;
  ratingCount?: number;
  createdAt: Date;
}

export interface BookingDoc {
  _id?: ObjectId;
  serviceId: string;
  serviceTitle: string;
  serviceImage: string;
  category: string;
  basePrice: number;
  finalAmount: number;
  technicianName: string;
  technicianEmail: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  address: string;
  preferredDate: Date;
  problemDescription: string;
  status: "requested" | "accepted" | "rejected" | "in-progress" | "completed" | "cancelled";
  paymentStatus: "unpaid" | "paid";
  statusHistory?: StatusEvent[];
  rating?: number;
  review?: string;
  createdAt: Date;
}

export interface PaymentDoc {
  _id?: ObjectId;
  bookingId: string;
  serviceTitle: string;
  customerName: string;
  customerEmail: string;
  technicianName: string;
  technicianEmail: string;
  amount: number;
  currency: string;
  transactionId: string;
  stripeSessionId: string;
  paymentStatus: "paid";
  paidAt: Date;
}

export interface UserDoc {
  _id?: ObjectId;
  name: string;
  email: string;
  image?: string | null;
  role: "customer" | "technician" | "admin";
  phone?: string;
  area?: string;
  bio?: string;
  createdAt?: Date;
}
