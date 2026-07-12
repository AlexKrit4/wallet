import { prisma } from "@/lib/prisma";
import { getRedis } from "@/lib/redis";

export async function GET() {
  try {
    await Promise.all([
      prisma.$queryRaw`SELECT 1`,
      getRedis().ping(),
    ]);
    return Response.json({ status: "ok" });
  } catch (error) {
    return Response.json(
      {
        status: "error",
        message: error instanceof Error ? error.message : "unknown",
      },
      { status: 503 },
    );
  }
}
