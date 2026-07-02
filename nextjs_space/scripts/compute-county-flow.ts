/**
 * Compute + persist county-level Deer Flow ratings.
 *
 * Joins TerrainAnalysisCache (per-parcel flow) to ParcelCache (county/state
 * by rounded lat/lng), aggregates a Deer Flow Index per county, and upserts
 * into CountyFlowRating.
 *
 * Idempotent: uses upsert keyed on (state, county). Safe to re-run. Run via:
 *   set -a; source .env; set +a; npx tsx scripts/compute-county-flow.ts
 */
import { prisma } from '../lib/db';
import {
  signalFromCacheData,
  parcelFlowIndex,
  normalizeCounty,
  finalizeCounty,
  type CountyAccumulator,
} from '../lib/county-flow';

function r3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

async function main() {
  console.log('[county-flow] loading ParcelCache county lookup…');
  const pcRows = await prisma.parcelCache.findMany({ select: { lat: true, lng: true, data: true } });
  // Rounded lat/lng -> { county, state }
  const countyLookup = new Map<string, { county: string; state: string }>();
  for (const p of pcRows) {
    try {
      const d = JSON.parse(p.data);
      const county = normalizeCounty(d.county);
      const state = (d.state || '').toUpperCase();
      if (county && /^[A-Z]{2}$/.test(state)) {
        countyLookup.set(`${r3(p.lat)},${r3(p.lng)}`, { county, state });
      }
    } catch {
      /* skip malformed cache rows */
    }
  }
  console.log(`[county-flow] county lookup entries: ${countyLookup.size}`);

  function findCounty(lat: number, lng: number): { county: string; state: string } | null {
    for (const dl of [0, 0.001, -0.001, 0.002, -0.002]) {
      for (const dg of [0, 0.001, -0.001, 0.002, -0.002]) {
        const hit = countyLookup.get(`${r3(lat + dl)},${r3(lng + dg)}`);
        if (hit) return hit;
      }
    }
    return null;
  }

  console.log('[county-flow] loading TerrainAnalysisCache…');
  const tacRows = await prisma.terrainAnalysisCache.findMany({
    select: { lat: true, lng: true, data: true },
  });

  const acc = new Map<string, CountyAccumulator>();
  let matched = 0;
  let unmatched = 0;
  let globalFlowSum = 0; // for the shrinkage prior (global per-parcel mean)

  for (const t of tacRows) {
    const loc = findCounty(t.lat, t.lng);
    if (!loc) {
      unmatched++;
      continue;
    }
    let signal;
    try {
      signal = signalFromCacheData(JSON.parse(t.data));
    } catch {
      continue;
    }
    const flow = parcelFlowIndex(signal);
    matched++;
    globalFlowSum += flow;
    const key = `${loc.state}|${loc.county}`;
    let a = acc.get(key);
    if (!a) {
      a = {
        state: loc.state,
        county: loc.county,
        flowSum: 0,
        funnelSum: 0,
        bedSum: 0,
        topSum: 0,
        count: 0,
        highFlow: 0,
      };
      acc.set(key, a);
    }
    a.flowSum += flow;
    a.funnelSum += signal.funnelCount ?? 0;
    a.bedSum += signal.beddingAcres ?? 0;
    a.topSum += signal.topStandScore ?? 0;
    a.count += 1;
    if (flow >= 75) a.highFlow += 1;
  }

  const priorMean = matched ? globalFlowSum / matched : 0;
  console.log(
    `[county-flow] parcels matched=${matched} unmatched=${unmatched} counties=${acc.size} priorMean=${priorMean.toFixed(1)}`,
  );

  // CountyFlowRating is fully derived/recomputable aggregate data (no user data).
  // Clear it first so renamed counties (e.g. slug "St-francois" -> "St. Francois")
  // don't leave stale duplicate rows behind.
  const cleared = await prisma.countyFlowRating.deleteMany({});
  console.log(`[county-flow] cleared ${cleared.count} stale rows.`);

  let written = 0;
  for (const a of acc.values()) {
    const f = finalizeCounty(a, priorMean);
    await prisma.countyFlowRating.create({ data: f });
    written++;
  }
  console.log(`[county-flow] wrote ${written} county rows.`);

  const top = await prisma.countyFlowRating.findMany({
    orderBy: { adjustedFlowIndex: 'desc' },
    take: 12,
  });
  console.log('[county-flow] top counties (by adjusted score):');
  for (const c of top) {
    console.log(
      `  ${c.county}, ${c.state}: adj ${c.adjustedFlowIndex} (${c.grade}) raw ${c.avgFlowIndex} · ${c.parcelCount} parcels · ${c.highFlowCount} high-flow${c.limitedData ? ' · LIMITED' : ''}`,
    );
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('[county-flow] error:', e);
  await prisma.$disconnect();
  process.exit(1);
});
