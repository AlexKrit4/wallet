import {
  Contract,
  JsonRpcProvider,
  Wallet,
  Interface,
  formatUnits,
  parseUnits,
  getAddress,
  type ContractRunner,
  type Log,
} from "ethers";

export const USDT_DECIMALS = 18;

/** Minimal ERC-20 ABI for USDT BEP-20 */
export const ERC20_ABI = [
  "event Transfer(address indexed from, address indexed to, uint256 value)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
] as const;

const erc20Interface = new Interface(ERC20_ABI);

export function getProvider() {
  const url = process.env.BSC_RPC_URL;
  if (!url) throw new Error("BSC_RPC_URL is not configured");
  return new JsonRpcProvider(url, { chainId: 56, name: "bnb" });
}

export function getUsdtAddress() {
  const address =
    process.env.USDT_CONTRACT_ADDRESS ??
    "0x55d398326f99059fF775485246999027B3197955";
  return getAddress(address);
}

export function getUsdtContract(runner?: ContractRunner) {
  return new Contract(getUsdtAddress(), ERC20_ABI, runner ?? getProvider());
}

export function getHotWallet() {
  const key = process.env.HOT_WALLET_PRIVATE_KEY;
  if (!key) throw new Error("HOT_WALLET_PRIVATE_KEY is not configured");
  return new Wallet(key, getProvider());
}

export function formatUsdt(raw: bigint) {
  return formatUnits(raw, USDT_DECIMALS);
}

export function parseUsdt(amount: string) {
  return parseUnits(amount, USDT_DECIMALS);
}

export type ParsedTransfer = {
  from: string;
  to: string;
  amount: string;
  txHash: string;
  logIndex: number;
  blockNumber: number;
  blockHash: string;
};

export function parseTransferLog(log: Log): ParsedTransfer | null {
  try {
    const parsed = erc20Interface.parseLog({
      topics: [...log.topics],
      data: log.data,
    });
    if (!parsed || parsed.name !== "Transfer") return null;

    const from = getAddress(parsed.args.from as string);
    const to = getAddress(parsed.args.to as string);
    const value = parsed.args.value as bigint;

    return {
      from,
      to,
      amount: formatUsdt(value),
      txHash: log.transactionHash,
      logIndex: log.index,
      blockNumber: log.blockNumber,
      blockHash: log.blockHash,
    };
  } catch {
    return null;
  }
}

export async function withRpcRetry<T>(
  operation: () => Promise<T>,
  attempts = 5,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(1_000 * 2 ** (attempt - 1), 15_000)),
      );
    }
  }
  throw lastError;
}

export function addDecimalStrings(a: string, b: string) {
  const sum = parseUsdt(a) + parseUsdt(b);
  return formatUsdt(sum);
}

export function subDecimalStrings(a: string, b: string) {
  const left = parseUsdt(a);
  const right = parseUsdt(b);
  if (left < right) throw new Error("Insufficient balance");
  return formatUsdt(left - right);
}

export function cmpDecimalStrings(a: string, b: string) {
  const left = parseUsdt(a);
  const right = parseUsdt(b);
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
