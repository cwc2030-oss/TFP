/**
 * Unit tests for the marketplace launch switch.
 *
 * Contract: closed by default; only the exact string "true" opens it, so a
 * fat-fingered env value can never accidentally launch the marketplace.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { isMarketplaceOpen, COMING_SOON_PATH } from '../lib/marketplace-gate';

const ORIGINAL = process.env.TFP_MARKETPLACE_OPEN;

afterEach(() => {
  if (ORIGINAL === undefined) {
    delete process.env.TFP_MARKETPLACE_OPEN;
  } else {
    process.env.TFP_MARKETPLACE_OPEN = ORIGINAL;
  }
});

describe('isMarketplaceOpen', () => {
  it('is closed when the env var is unset', () => {
    delete process.env.TFP_MARKETPLACE_OPEN;
    expect(isMarketplaceOpen()).toBe(false);
  });

  it('opens only for the exact string "true"', () => {
    process.env.TFP_MARKETPLACE_OPEN = 'true';
    expect(isMarketplaceOpen()).toBe(true);
  });

  it('stays closed for other truthy-looking values', () => {
    for (const v of ['false', '1', 'yes', 'TRUE', 'True', '', ' true ']) {
      process.env.TFP_MARKETPLACE_OPEN = v;
      expect(isMarketplaceOpen()).toBe(false);
    }
  });
});

describe('COMING_SOON_PATH', () => {
  it('points at the launch wall', () => {
    expect(COMING_SOON_PATH).toBe('/marketplace-coming-soon');
  });
});
