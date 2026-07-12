import { formatEther } from "ethers";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  formatUsdt,
  getHotWallet,
  getProvider,
  getUsdtContract,
} from "@/lib/bsc";
import { handleRouteError, jsonOk } from "@/lib/api";

export async function GET() {
  try {
    await requireAdmin();

    const [users, transactions, workers] = await Promise.all([
      prisma.user.findMany({
        orderBy: { createdAt: "desc" },
        take: 100,
        select: {
          id: true,
          email: true,
          role: true,
          kycStatus: true,
          isFrozen: true,
          createdAt: true,
          wallet: { select: { address: true } },
          balance: { select: { available: true, locked: true } },
        },
      }),
      prisma.transaction.findMany({
        orderBy: { createdAt: "desc" },
        take: 100,
        include: { user: { select: { email: true } } },
      }),
      prisma.workerHeartbeat.findMany({ orderBy: { name: "asc" } }),
    ]);

    let hotWallet:
      | { address: string; usdt: string; bnb: string; error?: never }
      | { address: string; usdt: null; bnb: null; error: string };
    try {
      const wallet = getHotWallet();
      const provider = getProvider();
      const token = getUsdtContract(provider);
      const [usdt, bnb] = await Promise.all([
        token.balanceOf(wallet.address) as Promise<bigint>,
        provider.getBalance(wallet.address),
      ]);
      hotWallet = {
        address: wallet.address,
        usdt: formatUsdt(usdt),
        bnb: formatEther(bnb),
      };
    } catch (error) {
      hotWallet = {
        address: "not configured",
        usdt: null,
        bnb: null,
        error: error instanceof Error ? error.message : "RPC error",
      };
    }

    return jsonOk({ users, transactions, workers, hotWallet });
  } catch (error) {
    return handleRouteError(error);
  }
}
