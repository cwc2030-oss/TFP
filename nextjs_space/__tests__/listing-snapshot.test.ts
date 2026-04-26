/**
 * Pure unit test for snapshotFromSavedProperty (lib/listings.ts).
 *
 * Chunk 3 must-have:
 *  - Build a fixture SavedProperty with all fields populated, including
 *    centroidLat and centroidLng.
 *  - Call the helper.
 *  - Assert returned object has the expected snapshot keys.
 *  - Assert returned object has NO key matching
 *    /lat|lng|long|geom|polygon|address|coord|parcel/i.
 *
 * The helper is a single line of provenance for SavedProperty data flowing
 * onto a Listing. If a future refactor accidentally pulls centroidLat or
 * an address field onto the snapshot, this test catches it.
 */
import { describe, it, expect } from 'vitest';
import { snapshotFromSavedProperty } from '../lib/listings';
import type { SavedProperty } from '@prisma/client';

const FIXTURE: SavedProperty = {
  id: 'sp-fixture',
  userId: 'u-fixture',
  name: 'Fixture Lease',
  type: 'territory',
  parcels: [{ ogc_fid: 12345, geometry: { coordinates: [[[1, 2]]] } }] as any,
  totalAcres: 240,
  // Realistic high-precision values that would obviously be a leak if they
  // ever showed up in the snapshot output.
  centroidLat: 38.987654 as any,
  centroidLng: -92.123456 as any,
  terrainScore: 87,
  primaryMovement: 'Draw funneling',
  funnelCount: 7,
  standCount: 5,
  bedAcres: 28.4,
  notes: null,
  shareId: 'share-fixture',
  isShared: false,
  createdAt: new Date('2025-01-01T00:00:00Z'),
  updatedAt: new Date('2025-02-15T12:34:56Z'),
};

describe('snapshotFromSavedProperty', () => {
  it('returns exactly the expected snapshot keys', () => {
    const out = snapshotFromSavedProperty(FIXTURE);
    expect(Object.keys(out).sort()).toEqual(
      [
        'acres',
        'bedAcres',
        'funnelCount',
        'primaryMovement',
        'savedPropertyUpdatedAt',
        'terrainScore',
      ].sort(),
    );
  });

  it('returned object has NO precise-location key (lat|lng|long|geom|polygon|address|coord|parcel)', () => {
    const out = snapshotFromSavedProperty(FIXTURE);
    const forbidden = /lat|lng|long|geom|polygon|address|coord|parcel/i;
    const violators = Object.keys(out).filter((k) => forbidden.test(k));
    expect(
      violators,
      `snapshot output contained forbidden keys: ${violators.join(', ')}`,
    ).toEqual([]);
  });

  it('correctly maps SavedProperty source fields to snapshot fields', () => {
    const out = snapshotFromSavedProperty(FIXTURE);
    expect(out.acres).toBe(240);
    expect(out.terrainScore).toBe(87);
    expect(out.primaryMovement).toBe('Draw funneling');
    expect(out.bedAcres).toBe(28.4);
    expect(out.funnelCount).toBe(7);
    expect(out.savedPropertyUpdatedAt).toEqual(new Date('2025-02-15T12:34:56Z'));
  });

  it('handles null optional fields gracefully', () => {
    const minimal: SavedProperty = {
      ...FIXTURE,
      terrainScore: null,
      primaryMovement: null,
      bedAcres: null,
      funnelCount: null,
    };
    const out = snapshotFromSavedProperty(minimal);
    expect(out.terrainScore).toBeNull();
    expect(out.primaryMovement).toBeNull();
    expect(out.bedAcres).toBeNull();
    expect(out.funnelCount).toBeNull();
    expect(out.acres).toBe(240);
  });

  it('serialized snapshot does NOT contain centroidLat/centroidLng numeric values', () => {
    const out = snapshotFromSavedProperty(FIXTURE);
    const json = JSON.stringify(out);
    expect(json.includes('38.987654')).toBe(false);
    expect(json.includes('-92.123456')).toBe(false);
    expect(json.includes('centroidLat')).toBe(false);
    expect(json.includes('centroidLng')).toBe(false);
  });
});
