import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const serializable = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  maxWait: 5_000,
  timeout: 15_000,
} as const;

export function decimal(value: string | number | Prisma.Decimal) {
  return new Prisma.Decimal(value);
}

export async function creditConfirmedDeposit(params: {
  userId: string;
  amount: string;
  txHash: string;
  logIndex: number;
  blockNumber: number;
  blockHash: string;
  fromAddress: string;
  toAddress: string;
  confirmations: number;
}) {
  const reference = `deposit:56:${params.txHash}:${params.logIndex}`;

  return prisma.$transaction(async (db) => {
    const existingTransaction = await db.transaction.findUnique({
      where: {
        chainId_txHash_logIndex: {
          chainId: 56,
          txHash: params.txHash,
          logIndex: params.logIndex,
        },
      },
    });
    if (existingTransaction?.status === "COMPLETED") return null;

    if (existingTransaction?.status === "CANCELLED") {
      await db.balance.update({
        where: { userId: params.userId },
        data: {
          available: { increment: decimal(params.amount) },
          version: { increment: 1 },
        },
      });
      await db.ledgerEntry.create({
        data: {
          userId: params.userId,
          transactionId: existingTransaction.id,
          direction: "CREDIT",
          account: "AVAILABLE",
          amount: decimal(params.amount),
          reference: `${reference}:recredit:${params.blockHash}`,
        },
      });
      const restored = await db.transaction.update({
        where: { id: existingTransaction.id },
        data: {
          status: "COMPLETED",
          blockNumber: params.blockNumber,
          blockHash: params.blockHash,
          confirmations: params.confirmations,
          completedAt: new Date(),
        },
      });
      const otherOrphans = await db.transaction.count({
        where: {
          userId: params.userId,
          type: "DEPOSIT",
          status: "CANCELLED",
          id: { not: restored.id },
        },
      });
      if (otherOrphans === 0) {
        await db.user.update({
          where: { id: params.userId },
          data: { isFrozen: false },
        });
      }
      return restored;
    }

    const existing = await db.ledgerEntry.findUnique({ where: { reference } });
    if (existing) return null;

    const transaction = await db.transaction.create({
      data: {
        userId: params.userId,
        type: "DEPOSIT",
        status: "COMPLETED",
        amount: decimal(params.amount),
        netAmount: decimal(params.amount),
        chainId: 56,
        txHash: params.txHash,
        logIndex: params.logIndex,
        blockNumber: params.blockNumber,
        blockHash: params.blockHash,
        fromAddress: params.fromAddress,
        toAddress: params.toAddress,
        confirmations: params.confirmations,
        completedAt: new Date(),
      },
    });

    await db.balance.upsert({
      where: { userId: params.userId },
      create: {
        userId: params.userId,
        available: decimal(params.amount),
        locked: decimal(0),
      },
      update: {
        available: { increment: decimal(params.amount) },
        version: { increment: 1 },
      },
    });

    await db.ledgerEntry.create({
      data: {
        userId: params.userId,
        transactionId: transaction.id,
        direction: "CREDIT",
        account: "AVAILABLE",
        amount: decimal(params.amount),
        reference,
      },
    });

    return transaction;
  }, serializable);
}

export async function reverseOrphanedDeposit(id: string) {
  return prisma.$transaction(async (db) => {
    const tx = await db.transaction.findUniqueOrThrow({ where: { id } });
    if (tx.type !== "DEPOSIT" || tx.status !== "COMPLETED") return null;

    await db.balance.update({
      where: { userId: tx.userId },
      data: {
        available: { decrement: tx.amount },
        version: { increment: 1 },
      },
    });
    await db.ledgerEntry.create({
      data: {
        userId: tx.userId,
        transactionId: tx.id,
        direction: "DEBIT",
        account: "AVAILABLE",
        amount: tx.amount,
        reference: `deposit-reorg:${tx.id}:${tx.blockHash ?? "unknown"}`,
      },
    });
    const unsignedWithdrawals = await db.transaction.findMany({
      where: {
        userId: tx.userId,
        type: "WITHDRAWAL",
        status: { in: ["PENDING", "PROCESSING"] },
        txHash: null,
      },
    });
    for (const withdrawal of unsignedWithdrawals) {
      await db.balance.update({
        where: { userId: tx.userId },
        data: {
          available: { increment: withdrawal.amount },
          locked: { decrement: withdrawal.amount },
          version: { increment: 1 },
        },
      });
      await db.ledgerEntry.createMany({
        data: [
          {
            userId: tx.userId,
            transactionId: withdrawal.id,
            direction: "DEBIT",
            account: "LOCKED",
            amount: withdrawal.amount,
            reference: `withdraw:${withdrawal.id}:reorg-unlock`,
          },
          {
            userId: tx.userId,
            transactionId: withdrawal.id,
            direction: "CREDIT",
            account: "AVAILABLE",
            amount: withdrawal.amount,
            reference: `withdraw:${withdrawal.id}:reorg-refund`,
          },
        ],
      });
      await db.transaction.update({
        where: { id: withdrawal.id },
        data: {
          status: "CANCELLED",
          failureReason: "Cancelled because account was frozen after a reorg",
        },
      });
    }
    await db.user.update({
      where: { id: tx.userId },
      data: { isFrozen: true },
    });
    return db.transaction.update({
      where: { id },
      data: {
        status: "CANCELLED",
        failureReason: "Deposit orphaned by chain reorganization",
      },
    });
  }, serializable);
}

export async function reserveWithdrawal(params: {
  userId: string;
  amount: Prisma.Decimal;
  fee: Prisma.Decimal;
  toAddress: string;
}) {
  const total = params.amount.plus(params.fee);

  return prisma.$transaction(async (db) => {
    const changed = await db.balance.updateMany({
      where: { userId: params.userId, available: { gte: total } },
      data: {
        available: { decrement: total },
        locked: { increment: total },
        version: { increment: 1 },
      },
    });
    if (changed.count !== 1) throw new Error("INSUFFICIENT_BALANCE");

    const transaction = await db.transaction.create({
      data: {
        userId: params.userId,
        type: "WITHDRAWAL",
        status: "PENDING",
        amount: total,
        fee: params.fee,
        netAmount: params.amount,
        toAddress: params.toAddress,
      },
    });

    await db.ledgerEntry.createMany({
      data: [
        {
          userId: params.userId,
          transactionId: transaction.id,
          direction: "DEBIT",
          account: "AVAILABLE",
          amount: total,
          reference: `withdraw:${transaction.id}:reserve`,
        },
        {
          userId: params.userId,
          transactionId: transaction.id,
          direction: "CREDIT",
          account: "LOCKED",
          amount: total,
          reference: `withdraw:${transaction.id}:lock`,
        },
      ],
    });

    return transaction;
  }, serializable);
}

export async function settleWithdrawal(id: string, txHash: string) {
  return prisma.$transaction(async (db) => {
    const tx = await db.transaction.findUniqueOrThrow({ where: { id } });
    if (tx.status === "COMPLETED") return tx;
    if (!["PROCESSING", "CONFIRMING"].includes(tx.status)) {
      throw new Error("INVALID_WITHDRAWAL_STATE");
    }

    await db.balance.update({
      where: { userId: tx.userId },
      data: {
        locked: { decrement: tx.amount },
        version: { increment: 1 },
      },
    });
    await db.ledgerEntry.create({
      data: {
        userId: tx.userId,
        transactionId: tx.id,
        direction: "DEBIT",
        account: "LOCKED",
        amount: tx.amount,
        reference: `withdraw:${tx.id}:settle`,
      },
    });
    return db.transaction.update({
      where: { id },
      data: {
        status: "COMPLETED",
        txHash,
        completedAt: new Date(),
        failureReason: null,
      },
    });
  }, serializable);
}

export async function refundWithdrawal(id: string, reason: string) {
  return prisma.$transaction(async (db) => {
    const tx = await db.transaction.findUniqueOrThrow({ where: { id } });
    if (["FAILED", "CANCELLED", "COMPLETED"].includes(tx.status)) return tx;

    await db.balance.update({
      where: { userId: tx.userId },
      data: {
        available: { increment: tx.amount },
        locked: { decrement: tx.amount },
        version: { increment: 1 },
      },
    });
    await db.ledgerEntry.createMany({
      data: [
        {
          userId: tx.userId,
          transactionId: tx.id,
          direction: "DEBIT",
          account: "LOCKED",
          amount: tx.amount,
          reference: `withdraw:${tx.id}:unlock`,
        },
        {
          userId: tx.userId,
          transactionId: tx.id,
          direction: "CREDIT",
          account: "AVAILABLE",
          amount: tx.amount,
          reference: `withdraw:${tx.id}:refund`,
        },
      ],
    });
    return db.transaction.update({
      where: { id },
      data: { status: "FAILED", failureReason: reason.slice(0, 500) },
    });
  }, serializable);
}
