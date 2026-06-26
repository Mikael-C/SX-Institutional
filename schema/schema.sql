-- SX Omni Chain Database Schema
-- Generated for V23 Demo

CREATE TABLE "Devices" (
    "id" VARCHAR(255) PRIMARY KEY,
    "name" VARCHAR(255) NOT NULL,
    "registeredAt" TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE TABLE "Users" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "address" VARCHAR(255) NOT NULL UNIQUE,
    "role" VARCHAR(50) DEFAULT 'user',
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE TABLE "Events" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "chain" VARCHAR(50) NOT NULL,
    "contractAddress" VARCHAR(255) NOT NULL,
    "eventName" VARCHAR(255) NOT NULL,
    "args" JSONB NOT NULL,
    "blockNumber" BIGINT NOT NULL,
    "txHash" VARCHAR(255) NOT NULL,
    "timestamp" TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE INDEX "events_chain_idx" ON "Events" ("chain");
CREATE INDEX "events_name_idx" ON "Events" ("eventName");

CREATE TABLE "Proposals" (
    "id" VARCHAR(255) PRIMARY KEY,
    "description" TEXT NOT NULL,
    "status" VARCHAR(50) DEFAULT 'Pending',
    "totalRequired" INTEGER NOT NULL,
    "approvals" JSONB DEFAULT '[]',
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE TABLE "JailbreakLogs" (
    "id" SERIAL PRIMARY KEY,
    "ipAddress" VARCHAR(255),
    "walletAddress" VARCHAR(255),
    "pattern" VARCHAR(255) NOT NULL,
    "input" TEXT NOT NULL,
    "blocked" BOOLEAN DEFAULT true,
    "lockoutUntil" TIMESTAMP WITH TIME ZONE,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE TABLE "OraclePrices" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "asset" VARCHAR(50) NOT NULL,
    "chain" VARCHAR(50) NOT NULL,
    "price" DECIMAL(20,8) NOT NULL,
    "source" VARCHAR(50) NOT NULL,
    "timestamp" TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE TABLE "LeveragedPositions" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "userId" UUID REFERENCES "Users"("id"),
    "asset" VARCHAR(50) NOT NULL,
    "leverage" INTEGER NOT NULL,
    "amount" DECIMAL(36,18) NOT NULL,
    "entryPrice" DECIMAL(20,8) NOT NULL,
    "liquidationPrice" DECIMAL(20,8) NOT NULL,
    "status" VARCHAR(50) DEFAULT 'open',
    "chain" VARCHAR(50) NOT NULL,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE TABLE "HiddenOrders" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "userId" UUID REFERENCES "Users"("id"),
    "tier" VARCHAR(50) NOT NULL, -- HOBL, HOPL, HOTL
    "commitmentHash" VARCHAR(255) NOT NULL,
    "status" VARCHAR(50) DEFAULT 'pending',
    "executionTx" VARCHAR(255),
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE TABLE "FrogScores" (
    "id" SERIAL PRIMARY KEY,
    "score" INTEGER NOT NULL, -- 0 to 200
    "fundingRateWeight" DECIMAL(5,4),
    "openInterestWeight" DECIMAL(5,4),
    "timestamp" TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE TABLE "RiskScores" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "userId" UUID REFERENCES "Users"("id"),
    "score" INTEGER NOT NULL, -- 0 to 100
    "factors" JSONB NOT NULL,
    "timestamp" TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE TABLE "Settlements" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "userId" UUID REFERENCES "Users"("id"),
    "targetChain" VARCHAR(50) NOT NULL,
    "netValue" DECIMAL(36,18) NOT NULL,
    "status" VARCHAR(50) DEFAULT 'pending',
    "timestamp" TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE TABLE "KycStatuses" (
    "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "userId" UUID REFERENCES "Users"("id"),
    "status" VARCHAR(50) DEFAULT 'pending',
    "verifiedAt" TIMESTAMP WITH TIME ZONE,
    "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL,
    "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL
);

-- Note: This is a unified Omni-Chain Schema that stores assets from both Hoodi and Base in the same tables, differentiated by the "chain" column.
