-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'LEASED', 'EXPIRED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "LeaseType" AS ENUM ('ANNUAL', 'SEASON_FULL', 'RIFLE_ONLY', 'BOW_ONLY', 'YOUTH', 'OTHER');

-- CreateEnum
CREATE TYPE "ContactMethod" AS ENUM ('EMAIL_RELAY', 'PHONE', 'BOTH');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "company" TEXT,
    "role" TEXT NOT NULL DEFAULT 'user',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "stripeCustomerId" TEXT,
    "stripePriceId" TEXT,
    "stripeSubscriptionId" TEXT,
    "subscriptionStatus" TEXT DEFAULT 'free',
    "subscriptionEnds" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MapLayer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "source" TEXT,
    "category" TEXT,
    "isAvailable" BOOLEAN NOT NULL DEFAULT true,
    "isPremium" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MapLayer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "parcelAddress" TEXT NOT NULL,
    "parcelLat" DOUBLE PRECISION NOT NULL,
    "parcelLng" DOUBLE PRECISION NOT NULL,
    "parcelId" TEXT,
    "selectedLayers" TEXT NOT NULL DEFAULT '[]',
    "guestEmail" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "paymentStatus" TEXT NOT NULL DEFAULT 'pending',
    "paymentIntentId" TEXT,
    "stripeSessionId" TEXT,
    "pdfPath" TEXT,
    "price" DOUBLE PRECISION NOT NULL DEFAULT 350,
    "productType" TEXT NOT NULL DEFAULT 'full_report',
    "terrainData" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "parcelId" TEXT,
    "address" TEXT,
    "source" TEXT NOT NULL DEFAULT 'email_parcel',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FunnelEvent" (
    "id" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "address" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FunnelEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParcelCache" (
    "id" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "data" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ParcelCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParcelPurchase" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "parcelLat" DOUBLE PRECISION NOT NULL,
    "parcelLng" DOUBLE PRECISION NOT NULL,
    "parcelAddress" TEXT,
    "parcelAcreage" DOUBLE PRECISION,
    "stripeSessionId" TEXT,
    "purchaseType" TEXT NOT NULL DEFAULT 'hunt_plan',
    "amount" INTEGER NOT NULL DEFAULT 1900,
    "purchasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ParcelPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedProperty" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "parcels" JSONB NOT NULL,
    "totalAcres" DOUBLE PRECISION NOT NULL,
    "centroidLat" DOUBLE PRECISION NOT NULL,
    "centroidLng" DOUBLE PRECISION NOT NULL,
    "terrainScore" INTEGER,
    "primaryMovement" TEXT,
    "funnelCount" INTEGER,
    "standCount" INTEGER,
    "bedAcres" DOUBLE PRECISION,
    "notes" TEXT,
    "shareId" TEXT,
    "isShared" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedProperty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Listing" (
    "id" TEXT NOT NULL,
    "savedPropertyId" TEXT NOT NULL,
    "savedPropertyUpdatedAt" TIMESTAMP(3),
    "ownerUserId" TEXT NOT NULL,
    "state" TEXT,
    "county" TEXT,
    "acres" DOUBLE PRECISION,
    "terrainScore" INTEGER,
    "primaryMovement" TEXT,
    "bedAcres" DOUBLE PRECISION,
    "funnelCount" INTEGER,
    "askingPriceMin" INTEGER,
    "askingPriceMax" INTEGER,
    "leaseType" "LeaseType",
    "huntersMax" INTEGER,
    "seasonAvailability" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "amenities" JSONB,
    "title" TEXT,
    "description" TEXT,
    "photos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "contactMethod" "ContactMethod",
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "status" "ListingStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "Listing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_stripeCustomerId_key" ON "User"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "User_stripeSubscriptionId_key" ON "User"("stripeSubscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "MapLayer_name_key" ON "MapLayer"("name");

-- CreateIndex
CREATE INDEX "Lead_email_idx" ON "Lead"("email");

-- CreateIndex
CREATE INDEX "FunnelEvent_event_idx" ON "FunnelEvent"("event");

-- CreateIndex
CREATE INDEX "FunnelEvent_createdAt_idx" ON "FunnelEvent"("createdAt");

-- CreateIndex
CREATE INDEX "ParcelCache_lat_lng_idx" ON "ParcelCache"("lat", "lng");

-- CreateIndex
CREATE UNIQUE INDEX "ParcelCache_lat_lng_key" ON "ParcelCache"("lat", "lng");

-- CreateIndex
CREATE INDEX "ParcelPurchase_userId_idx" ON "ParcelPurchase"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ParcelPurchase_userId_parcelLat_parcelLng_key" ON "ParcelPurchase"("userId", "parcelLat", "parcelLng");

-- CreateIndex
CREATE UNIQUE INDEX "SavedProperty_shareId_key" ON "SavedProperty"("shareId");

-- CreateIndex
CREATE INDEX "SavedProperty_userId_idx" ON "SavedProperty"("userId");

-- CreateIndex
CREATE INDEX "Listing_ownerUserId_status_idx" ON "Listing"("ownerUserId", "status");

-- CreateIndex
CREATE INDEX "Listing_state_status_idx" ON "Listing"("state", "status");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParcelPurchase" ADD CONSTRAINT "ParcelPurchase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedProperty" ADD CONSTRAINT "SavedProperty_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_savedPropertyId_fkey" FOREIGN KEY ("savedPropertyId") REFERENCES "SavedProperty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

