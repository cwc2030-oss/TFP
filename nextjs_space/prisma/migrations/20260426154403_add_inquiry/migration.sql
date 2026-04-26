-- CreateEnum
CREATE TYPE "InquiryStatus" AS ENUM ('NEW', 'REPLIED', 'CLOSED');

-- CreateTable
CREATE TABLE "Inquiry" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "hunterEmail" TEXT NOT NULL,
    "hunterName" TEXT NOT NULL,
    "hunterPhone" TEXT,
    "preferredDates" TEXT,
    "partySize" INTEGER NOT NULL DEFAULT 1,
    "message" TEXT NOT NULL,
    "status" "InquiryStatus" NOT NULL DEFAULT 'NEW',
    "source" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "ipHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "repliedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "Inquiry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Inquiry_listingId_status_idx" ON "Inquiry"("listingId", "status");

-- CreateIndex
CREATE INDEX "Inquiry_hunterEmail_idx" ON "Inquiry"("hunterEmail");

-- AddForeignKey
ALTER TABLE "Inquiry" ADD CONSTRAINT "Inquiry_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
