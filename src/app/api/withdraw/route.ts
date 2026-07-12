import { getAddress } from "ethers";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { withdrawSchema } from "@/lib/validators";
import { handleRouteError, jsonError, jsonOk } from "@/lib/api";
import { decimal, reserveWithdrawal } from "@/lib/ledger";
import { audit } from "@/lib/audit";
import { assertSameOrigin, getRequestIp, rateLimit } from "@/lib/security";
import { withRedisLock } from "@/lib/redis";

export async function POST(request: Request) {
  try {
    await assertSameOrigin(request);
    const user = await requireUser();
    const ip = await getRequestIp();
    await rateLimit("withdraw", user.id, 5, 60 * 60);
    if (user.kycStatus !== "APPROVED") {
      return jsonError("KYC must be approved before withdrawals");
    }
    if (user.isFrozen) {
      return jsonError("Account is frozen for manual review", 403);
    }

    const body = withdrawSchema.parse(await request.json());
    const toAddress = getAddress(body.address);
    const amount = decimal(body.amount);
    const min = decimal(process.env.MIN_WITHDRAWAL ?? "1");
    const fee = decimal(process.env.WITHDRAW_FEE ?? "0.1");
    const dailyMax = decimal(process.env.MAX_WITHDRAWAL_PER_DAY ?? "1000");

    if (amount.lessThan(min)) {
      return jsonError(`Minimum withdrawal is ${min.toString()} USDT`);
    }

    const ownWallet = await prisma.wallet.findUnique({ where: { userId: user.id } });
    if (ownWallet?.address.toLowerCase() === toAddress.toLowerCase()) {
      return jsonError("Cannot withdraw to your own deposit address");
    }

    const tx = await withRedisLock(`withdraw:user:${user.id}`, 30_000, async (assertHeld) => {
      const since = new Date();
      since.setUTCHours(0, 0, 0, 0);
      const today = await prisma.transaction.aggregate({
        where: {
          userId: user.id,
          type: "WITHDRAWAL",
          status: { notIn: ["FAILED", "CANCELLED"] },
          createdAt: { gte: since },
        },
        _sum: { netAmount: true },
      });
      const used = today._sum.netAmount ?? decimal(0);
      if (used.plus(amount).greaterThan(dailyMax)) {
        throw new Error(
          `Daily withdrawal limit is ${dailyMax.toString()} USDT`,
        );
      }

      await assertHeld();
      return reserveWithdrawal({
        userId: user.id,
        amount,
        fee,
        toAddress,
      });
    });
    if (!tx) return jsonError("Another withdrawal is being processed", 409);
    await audit({
      actorId: user.id,
      action: "WITHDRAWAL_CREATED",
      target: tx.id,
      ip,
      metadata: {
        amount: amount.toString(),
        fee: fee.toString(),
        toAddress,
      },
    });

    return jsonOk(
      {
        transaction: {
          ...tx,
          amount: tx.amount.toString(),
          fee: tx.fee.toString(),
          netAmount: tx.netAmount?.toString(),
        },
      },
      { status: 201 },
    );
  } catch (error) {
    return handleRouteError(error);
  }
}
