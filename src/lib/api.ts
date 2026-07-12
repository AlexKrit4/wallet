import { NextResponse } from "next/server";
import { ZodError } from "zod";

export function jsonOk<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export function handleRouteError(error: unknown) {
  if (error instanceof ZodError) {
    return jsonError(error.issues[0]?.message ?? "Invalid input", 400);
  }
  if (error instanceof Error) {
    if (error.message === "UNAUTHORIZED") return jsonError("Unauthorized", 401);
    if (error.message === "FORBIDDEN") return jsonError("Forbidden", 403);
    if (error.message === "RATE_LIMITED") {
      return jsonError("Too many requests. Try again later.", 429);
    }
    if (error.message === "INVALID_ORIGIN") {
      return jsonError("Invalid request origin", 403);
    }
    if (error.message === "INSUFFICIENT_BALANCE") {
      return jsonError("Insufficient available balance", 400);
    }
    return jsonError(error.message, 400);
  }
  return jsonError("Unexpected error", 500);
}
