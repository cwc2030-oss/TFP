import { z } from 'zod';
import type { SavedProperty } from '@prisma/client';
import { prisma } from '@/lib/db';
import { snapshotFromSavedProperty } from '@/lib/listings';
import { estimateLeasePerAcre } from '@/lib/lease-estimate';

export const listingPrefillResponseSchema = z.object({
  savedPropertyId: z.string().min(1),
  state: z.string().regex(/^[A-Z]{2}$/).nullable(),
  county: z.string().min(1).max(80).nullable(),
  acres: z.number().nullable(),
  terrainScore: z.number().int().nullable(),
  primaryMovement: z.string().nullable(),
  bedAcres: z.number().nullable(),
  funnelCount: z.number().int().nullable(),
  standCount: z.number().int().nullable(),
  leaseEstimate: z.string().nullable(),
}).strict();

export type ListingPrefillResponse = z.infer<typeof listingPrefillResponseSchema>;

type ParcelLite = {
  county?: unknown;
  state?: unknown;
  address?: unknown;
  acres?: unknown;
};

function asParcelArray(value: unknown): ParcelLite[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is ParcelLite => !!item && typeof item === 'object');
}

export function inferPublicRegionFromSavedProperty(sp: Pick<SavedProperty, 'parcels'>): {
  state: string | null;
  county: string | null;
} {
  const parcels = asParcelArray(sp.parcels);
  const first = parcels[0];
  const directCounty = typeof first?.county === 'string' ? first.county.trim() : '';
  const directState = typeof first?.state === 'string' ? first.state.trim().toUpperCase() : '';

  const rawAddress = typeof first?.address === 'string' ? first.address : '';
  const addressCounty = rawAddress
    .split(',')
    .map((part) => part.trim())
    .find((part) => /county/i.test(part))
    ?.replace(/county/i, '')
    .trim() ?? '';
  const stateZip = rawAddress.match(/\b([A-Z]{2})\s+\d{5}\b/);

  const state = /^[A-Z]{2}$/.test(directState)
    ? directState
    : (stateZip?.[1] ?? null);
  const county = (directCounty || addressCounty || '').replace(/\s+/g, ' ').trim() || null;

  return {
    state,
    county,
  };
}

export function buildListingPrefill(sp: SavedProperty): ListingPrefillResponse {
  const snapshot = snapshotFromSavedProperty(sp);
  const region = inferPublicRegionFromSavedProperty(sp);
  return listingPrefillResponseSchema.parse({
    savedPropertyId: sp.id,
    state: region.state,
    county: region.county,
    acres: snapshot.acres,
    terrainScore: snapshot.terrainScore,
    primaryMovement: snapshot.primaryMovement,
    bedAcres: snapshot.bedAcres,
    funnelCount: snapshot.funnelCount,
    standCount: sp.standCount ?? null,
    leaseEstimate: estimateLeasePerAcre({ topStandScore: snapshot.terrainScore }),
  });
}

export async function getListingPrefillForOwner(
  savedPropertyId: string,
  ownerUserId: string,
): Promise<ListingPrefillResponse | null> {
  const sp = await prisma.savedProperty.findFirst({
    where: { id: savedPropertyId, userId: ownerUserId },
  });
  if (!sp) return null;
  return buildListingPrefill(sp);
}
