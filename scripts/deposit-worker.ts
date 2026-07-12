import "dotenv/config";
import { getAddress, zeroPadValue } from "ethers";
import { prisma } from "../src/lib/prisma";
import {
  getProvider,
  getUsdtAddress,
  getUsdtContract,
  parseUsdt,
  parseTransferLog,
  withRpcRetry,
} from "../src/lib/bsc";
import {
  creditConfirmedDeposit,
  reverseOrphanedDeposit,
} from "../src/lib/ledger";
import { heartbeat } from "../src/lib/audit";
import { withRedisLock } from "../src/lib/redis";

const NAME = "deposit-worker";
const POLL_MS = Number(process.env.DEPOSIT_POLL_MS ?? 12_000);
const BLOCK_BATCH = Number(process.env.DEPOSIT_BLOCK_BATCH ?? 1_000);
const ADDRESS_BATCH = 100;

function chunks<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
}

async function ensureCursor(safeTip: number) {
  const configured = Number(process.env.BSC_START_BLOCK ?? safeTip);
  return prisma.chainCursor.upsert({
    where: { id: "bsc-usdt" },
    create: {
      id: "bsc-usdt",
      lastBlock: Math.min(configured, safeTip) - 1,
    },
    update: {},
  });
}

async function repairCursorIfReorged(lastBlock: number, blockHash: string | null) {
  if (!blockHash || lastBlock < 0) return lastBlock;
  const provider = getProvider();
  const block = await withRpcRetry(() => provider.getBlock(lastBlock));
  if (block?.hash === blockHash) return lastBlock;

  const checkpoints = await prisma.chainCheckpoint.findMany({
    where: { cursorId: "bsc-usdt", blockNumber: { lt: lastBlock } },
    orderBy: { blockNumber: "desc" },
  });
  let rollback = Math.max(
    -1,
    Number(process.env.BSC_START_BLOCK ?? 0) - 1,
  );
  for (const checkpoint of checkpoints) {
    const canonical = await withRpcRetry(() =>
      provider.getBlock(checkpoint.blockNumber),
    );
    if (canonical?.hash === checkpoint.blockHash) {
      rollback = checkpoint.blockNumber;
      break;
    }
  }
  const affected = await prisma.transaction.findMany({
    where: {
      type: "DEPOSIT",
      status: "COMPLETED",
      blockNumber: { gt: rollback, lte: lastBlock },
    },
    select: { id: true, blockNumber: true, blockHash: true },
  });
  const blocks = new Map<number, string | null>();
  for (const deposit of affected) {
    if (deposit.blockNumber === null) continue;
    if (!blocks.has(deposit.blockNumber)) {
      const canonical = await withRpcRetry(() =>
        provider.getBlock(deposit.blockNumber!),
      );
      blocks.set(deposit.blockNumber, canonical?.hash ?? null);
    }
    if (blocks.get(deposit.blockNumber) !== deposit.blockHash) {
      await reverseOrphanedDeposit(deposit.id);
    }
  }
  await prisma.$transaction([
    prisma.chainCursor.update({
      where: { id: "bsc-usdt" },
      data: { lastBlock: rollback, blockHash: null },
    }),
    prisma.wallet.updateMany({
      where: { lastScannedBlock: { gt: rollback } },
      data: { lastScannedBlock: rollback },
    }),
    prisma.chainCheckpoint.deleteMany({
      where: { cursorId: "bsc-usdt", blockNumber: { gt: rollback } },
    }),
  ]);
  console.warn(`[deposit] reorg detected, cursor rolled back to ${rollback}`);
  return rollback;
}

async function scanOnce() {
  const provider = getProvider();
  const tip = await withRpcRetry(() => provider.getBlockNumber());
  const confirmations = Number(process.env.DEPOSIT_CONFIRMATIONS ?? 12);
  const safeTip = tip - confirmations;
  if (safeTip < 0) return;

  const cursor = await ensureCursor(safeTip);
  const lastBlock = await repairCursorIfReorged(
    cursor.lastBlock,
    cursor.blockHash,
  );
  const wallets = await prisma.wallet.findMany({
    select: {
      id: true,
      address: true,
      userId: true,
      lastScannedBlock: true,
    },
  });
  const walletCursor = wallets.reduce(
    (minimum, wallet) =>
      Math.min(
        minimum,
        wallet.lastScannedBlock ??
          Math.max(
            -1,
            lastBlock - Number(process.env.DEPOSIT_INITIAL_LOOKBACK ?? 5_000),
          ),
      ),
    lastBlock,
  );
  let fromBlock = Math.min(lastBlock, walletCursor) + 1;
  if (fromBlock > safeTip) {
    await heartbeat(NAME, "healthy", { tip, safeTip, cursor: lastBlock });
    return;
  }
  const addressMap = new Map(
    wallets.map((wallet) => [getAddress(wallet.address), wallet.userId]),
  );
  const contract = getUsdtContract(provider);
  const transferTopic = contract.interface.getEvent("Transfer")!.topicHash;

  while (fromBlock <= safeTip) {
    const toBlock = Math.min(fromBlock + BLOCK_BATCH - 1, safeTip);
    let credited = 0;

    for (const group of chunks(wallets, ADDRESS_BATCH)) {
      const recipientTopics = group.map((wallet) =>
        zeroPadValue(getAddress(wallet.address), 32),
      );
      const logs = await withRpcRetry(() =>
        provider.getLogs({
          address: getUsdtAddress(),
          fromBlock,
          toBlock,
          topics: [transferTopic, null, recipientTopics],
        }),
      );

      for (const log of logs) {
        const transfer = parseTransferLog(log);
        if (!transfer) continue;
        if (parseUsdt(transfer.amount) === 0n) continue;
        const userId = addressMap.get(transfer.to);
        if (!userId) continue;

        const saved = await creditConfirmedDeposit({
          userId,
          amount: transfer.amount,
          txHash: transfer.txHash,
          logIndex: transfer.logIndex,
          blockNumber: transfer.blockNumber,
          blockHash: transfer.blockHash,
          fromAddress: transfer.from,
          toAddress: transfer.to,
          confirmations,
        });
        if (saved) {
          credited += 1;
          console.log(
            `[deposit] credited ${transfer.amount} USDT tx=${transfer.txHash}:${transfer.logIndex}`,
          );
        }
      }
    }

    const block = await withRpcRetry(() => provider.getBlock(toBlock));
    if (!block?.hash) throw new Error(`Block ${toBlock} was not returned`);
    await prisma.$transaction([
      prisma.chainCursor.update({
        where: { id: "bsc-usdt" },
        data: { lastBlock: toBlock, blockHash: block.hash },
      }),
      prisma.wallet.updateMany({
        where: { id: { in: wallets.map((wallet) => wallet.id) } },
        data: { lastScannedBlock: toBlock },
      }),
      prisma.chainCheckpoint.upsert({
        where: {
          cursorId_blockNumber: {
            cursorId: "bsc-usdt",
            blockNumber: toBlock,
          },
        },
        create: {
          cursorId: "bsc-usdt",
          blockNumber: toBlock,
          blockHash: block.hash,
        },
        update: { blockHash: block.hash },
      }),
    ]);
    await heartbeat(NAME, "healthy", {
      tip,
      safeTip,
      cursor: toBlock,
      credited,
    });
    console.log(`[deposit] scanned ${fromBlock}-${toBlock}, credited=${credited}`);
    fromBlock = toBlock + 1;
  }
}

async function main() {
  console.log("[deposit] worker started");
  for (;;) {
    try {
      await withRedisLock("worker:deposit", POLL_MS * 2, scanOnce);
    } catch (error) {
      console.error("[deposit] cycle failed", error);
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
