-- CreateEnum
CREATE TYPE "WaitlistSide" AS ENUM ('LANDOWNER', 'HUNTER');

-- CreateTable
CREATE TABLE "Waitlist" (
    "id" TEXT NOT NULL,
    "side" "WaitlistSide" NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "state" TEXT,
    "states" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "acres" DOUBLE PRECISION,
    "maxBudgetUsd" INTEGER,
    "seasonInterest" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "groupSize" INTEGER,
    "source" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Waitlist_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Waitlist_side_state_idx" ON "Waitlist"("side", "state");

-- CreateIndex
CREATE INDEX "Waitlist_email_idx" ON "Waitlist"("email");
