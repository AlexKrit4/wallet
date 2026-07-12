CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN');
CREATE TYPE "KycStatus" AS ENUM ('NONE', 'PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE "TxType" AS ENUM ('DEPOSIT', 'WITHDRAWAL');
CREATE TYPE "TxStatus" AS ENUM ('PENDING', 'PROCESSING', 'CONFIRMING', 'REVIEW', 'COMPLETED', 'FAILED', 'CANCELLED');
CREATE TYPE "LedgerDirection" AS ENUM ('CREDIT', 'DEBIT');
CREATE TYPE "SweepStatus" AS ENUM ('PENDING', 'FUNDING_GAS', 'SWEEPING', 'COMPLETED', 'FAILED');

CREATE TABLE "User" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "role" "Role" NOT NULL DEFAULT 'USER',
  "kycStatus" "KycStatus" NOT NULL DEFAULT 'NONE',
  "isFrozen" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KycSubmission" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "fullName" TEXT NOT NULL,
  "documentType" TEXT NOT NULL,
  "documentNumber" TEXT NOT NULL,
  "country" TEXT,
  "notes" TEXT,
  "status" "KycStatus" NOT NULL DEFAULT 'PENDING',
  "adminNote" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "reviewedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "KycSubmission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Wallet" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "address" TEXT NOT NULL,
  "derivationIndex" INTEGER NOT NULL,
  "lastScannedBlock" INTEGER,
  "chain" TEXT NOT NULL DEFAULT 'BSC',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Balance" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "asset" TEXT NOT NULL DEFAULT 'USDT',
  "available" DECIMAL(36,18) NOT NULL DEFAULT 0,
  "locked" DECIMAL(36,18) NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Balance_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Balance_locked_nonnegative" CHECK ("locked" >= 0)
);

CREATE TABLE "Transaction" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "type" "TxType" NOT NULL,
  "status" "TxStatus" NOT NULL DEFAULT 'PENDING',
  "amount" DECIMAL(36,18) NOT NULL,
  "fee" DECIMAL(36,18) NOT NULL DEFAULT 0,
  "netAmount" DECIMAL(36,18),
  "asset" TEXT NOT NULL DEFAULT 'USDT',
  "chainId" INTEGER NOT NULL DEFAULT 56,
  "txHash" TEXT,
  "broadcastHashes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "logIndex" INTEGER,
  "blockNumber" INTEGER,
  "blockHash" TEXT,
  "rawTransaction" TEXT,
  "nonce" INTEGER,
  "lastBroadcastAt" TIMESTAMP(3),
  "fromAddress" TEXT,
  "toAddress" TEXT,
  "confirmations" INTEGER NOT NULL DEFAULT 0,
  "failureReason" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "processingAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Transaction_amount_positive" CHECK ("amount" > 0),
  CONSTRAINT "Transaction_fee_nonnegative" CHECK ("fee" >= 0)
);

CREATE TABLE "ChainCursor" (
  "id" TEXT NOT NULL DEFAULT 'bsc-usdt',
  "lastBlock" INTEGER NOT NULL,
  "blockHash" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ChainCursor_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KeyCounter" (
  "id" TEXT NOT NULL DEFAULT 'bsc-deposit',
  "nextIndex" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KeyCounter_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ChainCheckpoint" (
  "id" TEXT NOT NULL,
  "cursorId" TEXT NOT NULL,
  "blockNumber" INTEGER NOT NULL,
  "blockHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChainCheckpoint_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LedgerEntry" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "transactionId" TEXT,
  "direction" "LedgerDirection" NOT NULL,
  "account" TEXT NOT NULL,
  "amount" DECIMAL(36,18) NOT NULL,
  "asset" TEXT NOT NULL DEFAULT 'USDT',
  "reference" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LedgerEntry_amount_positive" CHECK ("amount" > 0)
);

CREATE TABLE "Sweep" (
  "id" TEXT NOT NULL,
  "walletId" TEXT NOT NULL,
  "status" "SweepStatus" NOT NULL DEFAULT 'PENDING',
  "amount" DECIMAL(36,18) NOT NULL,
  "gasFundingHash" TEXT,
  "sweepTxHash" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "failureReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Sweep_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkerHeartbeat" (
  "name" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "metadata" JSONB,
  CONSTRAINT "WorkerHeartbeat_pkey" PRIMARY KEY ("name")
);

CREATE TABLE "AuditLog" (
  "id" TEXT NOT NULL,
  "actorId" TEXT,
  "action" TEXT NOT NULL,
  "target" TEXT,
  "ip" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "KycSubmission_status_idx" ON "KycSubmission"("status");
CREATE INDEX "KycSubmission_userId_idx" ON "KycSubmission"("userId");
CREATE UNIQUE INDEX "Wallet_userId_key" ON "Wallet"("userId");
CREATE UNIQUE INDEX "Wallet_address_key" ON "Wallet"("address");
CREATE UNIQUE INDEX "Wallet_derivationIndex_key" ON "Wallet"("derivationIndex");
CREATE UNIQUE INDEX "Balance_userId_key" ON "Balance"("userId");
CREATE INDEX "Transaction_userId_createdAt_idx" ON "Transaction"("userId", "createdAt");
CREATE INDEX "Transaction_status_type_idx" ON "Transaction"("status", "type");
CREATE UNIQUE INDEX "Transaction_chainId_txHash_logIndex_key" ON "Transaction"("chainId", "txHash", "logIndex");
CREATE UNIQUE INDEX "LedgerEntry_reference_key" ON "LedgerEntry"("reference");
CREATE UNIQUE INDEX "ChainCheckpoint_cursorId_blockNumber_key" ON "ChainCheckpoint"("cursorId", "blockNumber");
CREATE INDEX "ChainCheckpoint_cursorId_blockNumber_idx" ON "ChainCheckpoint"("cursorId", "blockNumber");
CREATE INDEX "LedgerEntry_userId_createdAt_idx" ON "LedgerEntry"("userId", "createdAt");
CREATE INDEX "LedgerEntry_transactionId_idx" ON "LedgerEntry"("transactionId");
CREATE UNIQUE INDEX "Sweep_sweepTxHash_key" ON "Sweep"("sweepTxHash");
CREATE INDEX "Sweep_status_createdAt_idx" ON "Sweep"("status", "createdAt");
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

ALTER TABLE "KycSubmission" ADD CONSTRAINT "KycSubmission_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Balance" ADD CONSTRAINT "Balance_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_transactionId_fkey"
  FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Sweep" ADD CONSTRAINT "Sweep_walletId_fkey"
  FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey"
  FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
