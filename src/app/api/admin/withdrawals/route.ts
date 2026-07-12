import { requireAdmin } from "@/lib/auth";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { handleRouteError, jsonError, jsonOk } from "@/lib/api";
import { audit } from "@/lib/audit";
import { assertSameOrigin, getRequestIp } from "@/lib/security";
import { getProvider } from "@/lib/bsc";
import { refundWithdrawal, settleWithdrawal } from "@/lib/ledger";

export async function POST(request: Request) {
  try {
    await assertSameOrigin(request);
    const admin = await requireAdmin();
    const ip = await getRequestIp();
    const body = (await request.json()) as {
      id?: string;
      action?: "retry" | "reconcile";
    };
    if (!body.id || !body.action) {
      return jsonError("id and action are required");
    }

    const tx = await prisma.transaction.findUnique({ where: { id: body.id } });
    if (!tx || tx.type !== "WITHDRAWAL") {
      return jsonError("Withdrawal not found", 404);
    }

    if (body.action === "reconcile") {
      if (tx.status !== "REVIEW" || tx.nonce === null || !tx.fromAddress) {
        return jsonError("Withdrawal is not awaiting review");
      }
      const provider = getProvider();
      for (const hash of tx.broadcastHashes) {
        const receipt = await provider.getTransactionReceipt(hash);
        if (!receipt) continue;
        await prisma.transaction.update({
          where: { id: tx.id },
          data: { status: "CONFIRMING" },
        });
        if (receipt.status === 1) await settleWithdrawal(tx.id, hash);
        else await refundWithdrawal(tx.id, "Reviewed transaction reverted");
        await audit({
          actorId: admin.id,
          action: "WITHDRAWAL_RECONCILED",
          target: tx.id,
          ip,
          metadata: { hash, receiptStatus: receipt.status ?? 0 },
        });
        return jsonOk({ ok: true, result: receipt.status === 1 ? "settled" : "refunded" });
      }

      const latestNonce = await provider.getTransactionCount(
        tx.fromAddress,
        "latest",
      );
      if (latestNonce > tx.nonce) {
        return jsonError(
          "Nonce was consumed but no known hash has a receipt; keep funds locked and investigate the address on BscScan",
          409,
        );
      }
      await prisma.transaction.update({
        where: { id: tx.id },
        data: {
          status: "CONFIRMING",
          attempts: 0,
          lastBroadcastAt: new Date(0),
          failureReason: "Admin approved another fee-bump cycle",
        },
      });
      await audit({
        actorId: admin.id,
        action: "WITHDRAWAL_RECONCILE_RESUMED",
        target: tx.id,
        ip,
      });
      return jsonOk({ ok: true, result: "replacement resumed" });
    }

    if (tx.status !== "FAILED") {
      return jsonError("Failed withdrawal not found", 404);
    }

    await prisma.$transaction(async (db) => {
      const claimed = await db.transaction.updateMany({
        where: { id: tx.id, status: "FAILED" },
        data: { status: "PROCESSING", processingAt: new Date() },
      });
      if (claimed.count !== 1) throw new Error("Withdrawal was already retried");

      const reserved = await db.balance.updateMany({
        where: { userId: tx.userId, available: { gte: tx.amount } },
        data: {
          available: { decrement: tx.amount },
          locked: { increment: tx.amount },
          version: { increment: 1 },
        },
      });
      if (reserved.count !== 1) throw new Error("INSUFFICIENT_BALANCE");

      const retryKey = Date.now().toString();
      await db.ledgerEntry.createMany({
        data: [
          {
            userId: tx.userId,
            transactionId: tx.id,
            direction: "DEBIT",
            account: "AVAILABLE",
            amount: tx.amount,
            reference: `withdraw:${tx.id}:retry:${retryKey}:reserve`,
          },
          {
            userId: tx.userId,
            transactionId: tx.id,
            direction: "CREDIT",
            account: "LOCKED",
            amount: tx.amount,
            reference: `withdraw:${tx.id}:retry:${retryKey}:lock`,
          },
        ],
      });
      await db.transaction.update({
        where: { id: tx.id },
        data: {
          status: "PENDING",
          attempts: 0,
          failureReason: null,
          processingAt: null,
          txHash: null,
          broadcastHashes: [],
          rawTransaction: null,
          nonce: null,
          lastBroadcastAt: null,
        },
      });
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    await audit({
      actorId: admin.id,
      action: "WITHDRAWAL_RETRIED",
      target: tx.id,
      ip,
    });
    return jsonOk({ ok: true });
  } catch (error) {
    return handleRouteError(error);
  }
}
