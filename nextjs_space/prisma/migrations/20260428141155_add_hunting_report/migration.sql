-- CreateTable
CREATE TABLE "HuntingReport" (
    "id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "ownerUserId" TEXT,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HuntingReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HuntingReport_ownerUserId_idx" ON "HuntingReport"("ownerUserId");

-- AddForeignKey
ALTER TABLE "HuntingReport" ADD CONSTRAINT "HuntingReport_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
