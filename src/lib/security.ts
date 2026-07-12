import { headers } from "next/headers";
import { getRedis } from "@/lib/redis";

export async function getRequestIp() {
  const list = await headers();
  return (
    list.get("cf-connecting-ip") ??
    list.get("x-real-ip") ??
    list.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

export async function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) {
    if (process.env.NODE_ENV === "production") throw new Error("INVALID_ORIGIN");
    return;
  }

  const expected = process.env.APP_URL;
  if (!expected || new URL(origin).origin !== new URL(expected).origin) {
    throw new Error("INVALID_ORIGIN");
  }
}

export async function rateLimit(
  scope: string,
  identifier: string,
  limit: number,
  windowSeconds: number,
) {
  const redis = getRedis();
  const key = `rate:${scope}:${identifier}`;
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, windowSeconds);
  if (count > limit) throw new Error("RATE_LIMITED");
}
