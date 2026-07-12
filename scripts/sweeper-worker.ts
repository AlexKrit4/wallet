import "dotenv/config";
import { getAddress, parseEther } from "ethers";
import { prisma } from "../src/lib/prisma";
import {
  getHotWallet,
  getProvider,
  getUsdtContract,
  formatUsdt,
  parseUsdt,
  withRpcRetry,
} from "../src/lib/bsc";
import { deriveDepositWallet } from "../src/lib/wallet";
import { heartbeat } from "../src/lib/audit";
import { withRedisLock } from "../src/lib/redis";

const NAME = "sweeper-worker";
const POLL_MS = Number(process.env.SWEEPER_POLL_MS ?? 60_000);
const THRESHOLD = parseUsdt(process.env.SWEEP_MIN_USDT ?? "1");
const MIN_GAS_TOPUP = parseEther(process.env.SWEEP_GAS_TOPUP_BNB ?? "0.0003");

async function sweepWallet(walletRow: {
  id: string;
  address: string;
  derivationIndex: number;
}) {
  const provider = getProvider();
  const depositWallet = deriveDepositWallet(walletRow.derivationIndex).connect(
    provider,
  );
  if (getAddress(depositWallet.address) !== getAddress(walletRow.address)) {
    throw new Error(`Derivation mismatch for wallet ${walletRow.id}`);
  }

  const token = getUsdtContract(depositWallet);
  const amount = (await token.balanceOf(depositWallet.address)) as bigint;
  if (amount < THRESHOLD) return;

  const existing = await prisma.sweep.findFirst({
    where: {
      walletId: walletRow.id,
      status: { in: ["FUNDING_GAS", "SWEEPING"] },
    },
  });
  if (existing) return;

  const sweep = await prisma.sweep.create({
    data: {
      walletId: walletRow.id,
      amount: formatUsdt(amount),
      status: "PENDING",
    },
  });

  try {
    const hotWallet = getHotWallet();
    const [gasBalance, feeData] = await Promise.all([
      provider.getBalance(depositWallet.address),
      provider.getFeeData(),
    ]);
    const gasPrice = feeData.gasPrice;
    if (!gasPrice) throw new Error("RPC did not return gas price");
    const conservativeGasLimit = BigInt(
      process.env.SWEEP_TRANSFER_GAS_LIMIT ?? "100000",
    );
    const requiredGas = (conservativeGasLimit * gasPrice * 130n) / 100n;

    if (gasBalance < requiredGas) {
      const topup =
        requiredGas - gasBalance > MIN_GAS_TOPUP
          ? requiredGas - gasBalance
          : MIN_GAS_TOPUP;
      await prisma.sweep.update({
        where: { id: sweep.id },
        data: { status: "FUNDING_GAS", attempts: { increment: 1 } },
      });

      const funding = await withRedisLock(
        "wallet:hot:send",
        120_000,
        async (assertHeld) => {
          await assertHeld();
          return withRpcRetry(() =>
          hotWallet.sendTransaction({
            to: depositWallet.address,
            value: topup,
          }),
          );
        },
      );
      if (!funding) throw new Error("HOT_WALLET_BUSY");
      await prisma.sweep.update({
        where: { id: sweep.id },
        data: { gasFundingHash: funding.hash },
      });
      const receipt = await funding.wait();
      if (!receipt || receipt.status !== 1) throw new Error("Gas top-up failed");
    }

    await prisma.sweep.update({
      where: { id: sweep.id },
      data: { status: "SWEEPING" },
    });
    const response = await withRpcRetry(() =>
      token.transfer(hotWallet.address, amount),
    );
    await prisma.sweep.update({
      where: { id: sweep.id },
      data: { sweepTxHash: response.hash },
    });
    const receipt = await response.wait();
    if (!receipt || receipt.status !== 1) throw new Error("Sweep reverted");

    await prisma.sweep.update({
      where: { id: sweep.id },
      data: { status: "COMPLETED" },
    });
    console.log(
      `[sweeper] swept wallet=${walletRow.address} tx=${response.hash}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown";
    await prisma.sweep.update({
      where: { id: sweep.id },
      data: {
        status: "FAILED",
        failureReason: message.slice(0, 500),
      },
    });
    throw error;
  }
}

async function cycle() {
  const wallets = await prisma.wallet.findMany({
    select: { id: true, address: true, derivationIndex: true },
    orderBy: { derivationIndex: "asc" },
  });
  for (const wallet of wallets) {
    try {
      await sweepWallet(wallet);
    } catch (error) {
      console.error(`[sweeper] wallet ${wallet.address} failed`, error);
    }
  }
  await heartbeat(NAME, "healthy", { wallets: wallets.length });
}

async function main() {
  console.log("[sweeper] worker started");
  for (;;) {
    try {
      await withRedisLock("worker:sweeper", POLL_MS * 2, cycle);
    } catch (error) {
      console.error("[sweeper] cycle failed", error);
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
