import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { jsonError, jsonOk } from "@/lib/api";

export async function GET() {
  const session = await getSession();
  if (!session) return jsonError("Unauthorized", 401);

  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: {
      id: true,
      email: true,
      role: true,
      kycStatus: true,
      isFrozen: true,
      wallet: { select: { address: true, chain: true } },
      balance: { select: { asset: true, available: true, locked: true } },
    },
  });

  if (!user) return jsonError("Unauthorized", 401);
  return jsonOk({ user });
}
