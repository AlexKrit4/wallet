import { z } from "zod";

export const registerSchema = z.object({
  email: z.string().email("Invalid email").max(254),
  password: z
    .string()
    .min(12, "Password must be at least 12 characters")
    .max(128)
    .regex(/[a-z]/, "Password must contain a lowercase letter")
    .regex(/[A-Z]/, "Password must contain an uppercase letter")
    .regex(/\d/, "Password must contain a number"),
});

export const loginSchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(128),
});

export const kycSchema = z.object({
  fullName: z.string().min(2, "Full name is required"),
  documentType: z.enum(["passport", "id_card", "driver_license"]),
  documentNumber: z.string().min(3, "Document number is required"),
  country: z.string().min(2).optional(),
  notes: z.string().max(500).optional(),
});

export const withdrawSchema = z.object({
  address: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid BSC address"),
  amount: z
    .string()
    .regex(/^\d+(\.\d{1,18})?$/, "Invalid amount"),
});
