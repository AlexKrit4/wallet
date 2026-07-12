import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { handleRouteError, jsonOk } from "@/lib/api";

export async function GET() {
  try {
    const user = await requireUser();
    const transactions = await prisma.transaction.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return jsonOk({ transactions });
  } catch (error) {
    return handleRouteError(error);
  }
}
