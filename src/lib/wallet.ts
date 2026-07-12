import { HDNodeWallet, Mnemonic, getAddress } from "ethers";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

function getMasterMnemonic() {
  const phrase = process.env.MASTER_MNEMONIC?.trim();
  if (!phrase) {
    throw new Error("MASTER_MNEMONIC is not configured");
  }
  return Mnemonic.fromPhrase(phrase);
}

export function deriveDepositWallet(index: number) {
  const mnemonic = getMasterMnemonic();
  return HDNodeWallet.fromMnemonic(mnemonic, `m/44'/60'/0'/0/${index}`);
}

export async function provisionWalletForUser(userId: string) {
  const existing = await prisma.wallet.findUnique({ where: { userId } });
  if (existing) return existing;

  return prisma.$transaction(async (tx) => {
    const alreadyCreated = await tx.wallet.findUnique({ where: { userId } });
    if (alreadyCreated) return alreadyCreated;

    const counter = await tx.keyCounter.upsert({
      where: { id: "bsc-deposit" },
      create: { id: "bsc-deposit", nextIndex: 1 },
      update: { nextIndex: { increment: 1 } },
    });
    const derivationIndex = counter.nextIndex - 1;
    const address = getAddress(deriveDepositWallet(derivationIndex).address);
    const cursor = await tx.chainCursor.findUnique({
      where: { id: "bsc-usdt" },
      select: { lastBlock: true },
    });

    const wallet = await tx.wallet.create({
      data: {
        userId,
        address,
        derivationIndex,
        lastScannedBlock: cursor?.lastBlock ?? null,
        chain: "BSC",
      },
    });

    await tx.balance.upsert({
      where: { userId },
      create: { userId, asset: "USDT", available: 0, locked: 0 },
      update: {},
    });

    return wallet;
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  });
}
