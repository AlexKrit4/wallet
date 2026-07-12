import "dotenv/config";
import { keccak256, Transaction as EthTransaction } from "ethers";
import type { Transaction as DbTransaction } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import {
  getHotWallet,
  getProvider,
  getUsdtContract,
  parseUsdt,
  withRpcRetry,
} from "../src/lib/bsc";
import { refundWithdrawal, settleWithdrawal } from "../src/lib/ledger";
import { audit, heartbeat } from "../src/lib/audit";
import { withRedisLock } from "../src/lib/redis";

const NAME = "withdrawal-worker";
const POLL_MS = Number(process.env.WITHDRAW_POLL_MS ?? 10_000);
const MAX_ATTEMPTS = Number(process.env.WITHDRAW_MAX_ATTEMPTS ?? 5);
const REPLACE_AFTER_MS = Number(
  process.env.WITHDRAW_REPLACE_AFTER_MS ?? 120_000,
);

async function replacePending(
  tx: DbTransaction,
) {
  if (!tx.rawTransaction || tx.nonce === null || !tx.fromAddress) return;
  const lastSent = tx.lastBroadcastAt?.getTime() ?? 0;
  if (Date.now() - lastSent < REPLACE_AFTER_MS) return;
  if (tx.attempts >= MAX_ATTEMPTS) {
    await prisma.transaction.update({
      where: { id: tx.id },
      data: {
        status: "REVIEW",
        failureReason: "Manual review required: max fee bumps reached",
      },
    });
    return;
  }

  await withRedisLock("wallet:hot:send", 120_000, async (assertHeld) => {
    const provider = getProvider();
    const latestNonce = await provider.getTransactionCount(
      tx.fromAddress!,
      "latest",
    );
    if (latestNonce > tx.nonce!) {
      await prisma.transaction.update({
        where: { id: tx.id },
        data: {
          status: "REVIEW",
          failureReason:
            "Manual review required: nonce mined but known receipts missing",
        },
      });
      return;
    }

    const parsed = EthTransaction.from(tx.rawTransaction!);
    const gasPrice = parsed.gasPrice;
    if (!gasPrice) throw new Error("Stored transaction has no gas price");
    const wallet = getHotWallet();
    const rawTransaction = await wallet.signTransaction({
      to: parsed.to,
      data: parsed.data,
      value: parsed.value,
      chainId: parsed.chainId,
      nonce: parsed.nonce,
      gasLimit: parsed.gasLimit,
      gasPrice: (gasPrice * 125n) / 100n + 1n,
      type: 0,
    });
    const txHash = keccak256(rawTransaction);
    const hashes = [...tx.broadcastHashes, txHash];
    await assertHeld();
    await prisma.transaction.update({
      where: { id: tx.id },
      data: {
        txHash,
        broadcastHashes: hashes,
        rawTransaction,
        lastBroadcastAt: new Date(),
        attempts: { increment: 1 },
        failureReason: "Fee-bumped replacement broadcast",
      },
    });
    await assertHeld();
    await withRpcRetry(() => provider.broadcastTransaction(rawTransaction));
    console.log(`[withdraw] replacement ${tx.id} tx=${txHash}`);
  });
}

async function reconcileConfirming() {
  const provider = getProvider();
  const pending = await prisma.transaction.findMany({
    where: {
      type: "WITHDRAWAL",
      status: "CONFIRMING",
      txHash: { not: null },
    },
    orderBy: { processingAt: "asc" },
    take: 20,
  });

  for (const tx of pending) {
    const hashes =
      tx.broadcastHashes.length > 0 ? tx.broadcastHashes : [tx.txHash!];
    let receipt = null;
    let minedHash: string | null = null;
    for (const hash of hashes) {
      receipt = await withRpcRetry(() => provider.getTransactionReceipt(hash));
      if (receipt) {
        minedHash = hash;
        break;
      }
    }
    if (!receipt) {
      await replacePending(tx);
      continue;
    }

    if (receipt.status === 1) {
      await settleWithdrawal(tx.id, minedHash!);
      await audit({
        actorId: tx.userId,
        action: "WITHDRAWAL_COMPLETED",
        target: tx.id,
        metadata: { txHash: minedHash! },
      });
      console.log(`[withdraw] confirmed ${tx.id} tx=${minedHash}`);
    } else {
      await refundWithdrawal(tx.id, "On-chain transaction reverted");
      await audit({
        actorId: tx.userId,
        action: "WITHDRAWAL_FAILED",
        target: tx.id,
        metadata: { txHash: tx.txHash!, reason: "reverted" },
      });
    }
  }
}

async function claimNext() {
  const candidate = await prisma.transaction.findFirst({
    where: {
      type: "WITHDRAWAL",
      status: "PENDING",
      user: { isFrozen: false },
    },
    orderBy: { createdAt: "asc" },
  });
  if (!candidate) return null;

  const claimed = await prisma.transaction.updateMany({
    where: { id: candidate.id, status: "PENDING" },
    data: {
      status: "PROCESSING",
      processingAt: new Date(),
      attempts: { increment: 1 },
    },
  });
  if (claimed.count !== 1) return null;
  return prisma.transaction.findUnique({ where: { id: candidate.id } });
}

async function sendOne() {
  const tx = await claimNext();
  if (!tx) return;
  if (!tx.toAddress || !tx.netAmount) {
    await refundWithdrawal(tx.id, "Invalid withdrawal payload");
    return;
  }

  try {
    const wallet = getHotWallet();
    const contract = getUsdtContract(wallet);
    const rawAmount = parseUsdt(tx.netAmount.toFixed());
    const [tokenBalance, gasBalance] = await Promise.all([
      contract.balanceOf(wallet.address) as Promise<bigint>,
      wallet.provider!.getBalance(wallet.address),
    ]);
    if (tokenBalance < rawAmount) throw new Error("HOT_WALLET_USDT_LOW");
    if (gasBalance === 0n) throw new Error("HOT_WALLET_BNB_LOW");

    const hash = await withRedisLock(
      "wallet:hot:send",
      120_000,
      async (assertHeld) => {
      const provider = getProvider();
      const current = await prisma.transaction.findUnique({
        where: { id: tx.id },
        include: { user: { select: { isFrozen: true } } },
      });
      if (
        !current ||
        current.status !== "PROCESSING" ||
        current.user.isFrozen
      ) {
        throw new Error("WITHDRAWAL_NO_LONGER_SENDABLE");
      }
      const [nonce, feeData, gasLimit, network] = await Promise.all([
        provider.getTransactionCount(wallet.address, "pending"),
        provider.getFeeData(),
        contract.transfer.estimateGas(tx.toAddress!, rawAmount),
        provider.getNetwork(),
      ]);
      if (!feeData.gasPrice) throw new Error("RPC did not return gas price");

      const populated = await contract.transfer.populateTransaction(
        tx.toAddress!,
        rawAmount,
      );
      const rawTransaction = await wallet.signTransaction({
        ...populated,
        chainId: network.chainId,
        nonce,
        gasPrice: feeData.gasPrice,
        gasLimit: (gasLimit * 120n) / 100n,
        type: 0,
      });
      const txHash = keccak256(rawTransaction);

      await assertHeld();
      await prisma.transaction.update({
        where: { id: tx.id },
        data: {
          status: "CONFIRMING",
          txHash,
          broadcastHashes: [txHash],
          rawTransaction,
          nonce,
          lastBroadcastAt: new Date(),
          fromAddress: wallet.address,
        },
      });
      await assertHeld();
      await withRpcRetry(() => provider.broadcastTransaction(rawTransaction));
      return txHash;
      },
    );
    if (!hash) throw new Error("HOT_WALLET_BUSY");
    console.log(`[withdraw] broadcast ${tx.id} tx=${hash}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    console.error(`[withdraw] send failed ${tx.id}: ${message}`);
    const latest = await prisma.transaction.findUnique({ where: { id: tx.id } });
    if (latest?.status === "CONFIRMING" && latest.txHash) {
      await prisma.transaction.update({
        where: { id: tx.id },
        data: { failureReason: `Broadcast uncertain: ${message}`.slice(0, 500) },
      });
      return;
    }

    if (tx.attempts >= MAX_ATTEMPTS) {
      await refundWithdrawal(tx.id, message);
      await audit({
        actorId: tx.userId,
        action: "WITHDRAWAL_FAILED",
        target: tx.id,
        metadata: { reason: message },
      });
    } else {
      await prisma.transaction.updateMany({
        where: { id: tx.id, status: "PROCESSING", txHash: null },
        data: { status: "PENDING", failureReason: message.slice(0, 500) },
      });
    }
  }
}

async function resetStaleClaims() {
  const before = new Date(Date.now() - 10 * 60_000);
  await prisma.transaction.updateMany({
    where: {
      type: "WITHDRAWAL",
      status: "PROCESSING",
      txHash: null,
      processingAt: { lt: before },
    },
    data: { status: "PENDING" },
  });
}

async function cycle() {
  await resetStaleClaims();
  await reconcileConfirming();
  await sendOne();
  await heartbeat(NAME, "healthy", {
    hotWallet: getHotWallet().address,
  });
}

async function main() {
  console.log("[withdraw] worker started");
  for (;;) {
    try {
      await withRedisLock("worker:withdrawal", POLL_MS * 3, cycle);
    } catch (error) {
      console.error("[withdraw] cycle failed", error);
      await heartbeat(NAME, "error", {
        message: error instanceof Error ? error.message : "unknown",
      }).catch(() => undefined);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
