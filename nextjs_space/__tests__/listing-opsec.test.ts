/**
 * OPSEC tests — Chunk 1.
 *
 * (1) The Listing model in the Prisma schema must NOT contain any field
 *     name matching /lat|lng|long|geom|polygon|address|coord/i.
 * (2) The publish-snapshot helper (snapshotFromSavedProperty in lib/listings.ts)
 *     must NOT read centroidLat or centroidLng from SavedProperty.
 *
 * These are belt-and-suspenders — the real protection is the architecture
 * (Listing has no precise-location columns; the API is .strict()-allowlisted).
 * But an automated check makes it impossible to slip a leak in by accident.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SCHEMA_PATH = path.resolve(__dirname, '..', 'prisma', 'schema.prisma');
const LIB_PATH = path.resolve(__dirname, '..', 'lib', 'listings.ts');

describe('OPSEC: Listing model has no precise-location fields', () => {
  it('introspecting prisma schema, no Listing field name matches forbidden pattern', () => {
    const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8');

    // Extract just the `model Listing { ... }` block.
    const match = schema.match(/model\s+Listing\s*\{([\s\S]*?)\n\}/);
    expect(match, 'Listing model not found in schema.prisma').toBeTruthy();
    const body = match![1];

    // Pull every field NAME (the first identifier on each non-comment line).
    const fieldNames: string[] = [];
    for (const rawLine of body.split('\n')) {
      const line = rawLine.trim();
      if (!line) continue;
      if (line.startsWith('//')) continue;
      if (line.startsWith('@@')) continue;
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\b/);
      if (m) fieldNames.push(m[1]);
    }

    expect(fieldNames.length).toBeGreaterThan(0);

    const forbidden = /lat|lng|long|geom|polygon|address|coord/i;
    const violators = fieldNames.filter((f) => forbidden.test(f));
    expect(
      violators,
      `Forbidden field names on Listing: ${violators.join(', ')}`,
    ).toEqual([]);
  });
});

describe('OPSEC: snapshot helper does not read SavedProperty centroidLat/centroidLng', () => {
  it('source of snapshotFromSavedProperty contains no lat/lng identifier', () => {
    const src = fs.readFileSync(LIB_PATH, 'utf-8');

    // Extract everything from `export function snapshotFromSavedProperty` to
    // its closing brace (we capture with a counter rather than balanced regex).
    const startIdx = src.indexOf('export function snapshotFromSavedProperty');
    expect(startIdx, 'snapshotFromSavedProperty not found').toBeGreaterThan(-1);
    let depth = 0;
    let i = src.indexOf('{', startIdx);
    expect(i).toBeGreaterThan(-1);
    const bodyStart = i;
    for (; i < src.length; i++) {
      const ch = src[i];
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) break;
      }
    }
    const fnSrc = src.slice(bodyStart, i + 1);

    // Strip line and block comments — the test must not flag the documentation
    // that explicitly says "do not read centroidLat".
    const stripped = fnSrc
      .replace(/\/\/[^\n]*/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');

    const forbidden = /(centroidLat|centroidLng)/;
    expect(
      stripped.match(forbidden),
      'snapshot helper code references centroidLat/centroidLng',
    ).toBeNull();
  });
});
