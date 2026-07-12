import "dotenv/config";
import { Mnemonic, HDNodeWallet } from "ethers";

const wallet = HDNodeWallet.createRandom();
const mnemonic = wallet.mnemonic;

if (!mnemonic) {
  throw new Error("Failed to generate mnemonic");
}

// Validate
Mnemonic.fromPhrase(mnemonic.phrase);

console.log("MASTER_MNEMONIC=");
console.log(mnemonic.phrase);
console.log("\nFirst deposit address (index 0):", wallet.address);
console.log("\nStore MASTER_MNEMONIC only in .env — never commit it.");
