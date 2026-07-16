/**
 * r2 hardening verification harness.
 * Exercises generateTerrainStory with malformed / partial / synthetic / cold
 * flow shapes that were the real 'Analysis failed' crash risk. Any UNCAUGHT
 * throw here = regression. A caught throw that logs [TerrainStory] and returns
 * an empty story = the guard working as intended.
 */
import { generateTerrainStory } from '../lib/terrain-story';

const fc = (features: any[] = []) => ({ type: 'FeatureCollection', features });

let uncaught = 0;
let ran = 0;

function run(name: string, flow: any, ridge?: any) {
  ran++;
  try {
    const story = generateTerrainStory(flow, 120, 'Test Parcel', ridge);
    const ok = story && typeof story.headline === 'string';
    console.log(`  [PASS] ${name} -> headline="${story?.headline}" conf=${(story?.confidence as any)?.level ?? story?.primaryDriver?.confidence}`);
    if (!ok) { uncaught++; console.log(`    !! returned malformed story`); }
  } catch (e) {
    uncaught++;
    console.log(`  [THROW-UNCAUGHT] ${name} -> ${(e as Error).message}`);
  }
}

console.log('=== r2 hardening harness ===');

// 1. null flow
run('null flow', null);

// 2. empty-ish valid-shape flow (cold/flat parcel)
run('cold flat parcel', {
  success: true,
  bbox: [-90.3, 37.9, -90.2, 38.0],
  flow_primary: fc(),
  flow_secondary: fc(),
  convergence_zones: fc(),
  opportunity_zones: fc(),
  metadata: { mode: 'terrain_driven', dem_source: 'srtm', weights: {}, thresholds: {}, stats: {} },
});

// 3. missing metadata entirely
run('missing metadata', {
  success: true,
  bbox: [-90.3, 37.9, -90.2, 38.0],
  flow_primary: fc(),
  flow_secondary: fc(),
  convergence_zones: fc(),
  opportunity_zones: fc(),
});

// 4. missing metadata.weights
run('missing metadata.weights', {
  success: true,
  bbox: [-90.3, 37.9, -90.2, 38.0],
  flow_primary: fc(),
  flow_secondary: fc(),
  convergence_zones: fc(),
  opportunity_zones: fc(),
  metadata: { mode: 'synthetic' },
});

// 5. missing bbox + missing collections (deeply partial synthetic)
run('deeply partial synthetic', {
  success: false,
  metadata: { mode: 'synthetic', fallback_reason: 'no dem' },
});

// 6. null feature arrays
run('null feature arrays', {
  success: true,
  bbox: undefined,
  flow_primary: null,
  flow_secondary: null,
  convergence_zones: null,
  opportunity_zones: null,
  metadata: { mode: 'error' },
});

// 7. convergence with features but broken props
run('convergence broken props', {
  success: true,
  bbox: [-90.3, 37.9, -90.2, 38.0],
  flow_primary: fc([{ type: 'Feature', properties: null, geometry: { type: 'LineString', coordinates: [[-90.25,37.95],[-90.24,37.96]] } }]),
  flow_secondary: fc(),
  convergence_zones: fc([{ type: 'Feature', properties: null, geometry: { type: 'Point', coordinates: [-90.25,37.95] } }]),
  opportunity_zones: fc([{ type: 'Feature', properties: undefined, geometry: { type: 'Point', coordinates: [-90.25,37.95] } }]),
  metadata: { mode: 'real_dem', dem_source: '1m', weights: {}, stats: {} },
});

// 8. ridge data with missing metadata
run('cold flow + partial ridge', {
  success: true,
  bbox: [-90.3, 37.9, -90.2, 38.0],
  flow_primary: fc(),
  flow_secondary: fc(),
  convergence_zones: fc(),
  opportunity_zones: fc(),
  metadata: { mode: 'terrain_driven', weights: {} },
}, { ridges_primary: null, saddle_nodes: undefined });

console.log(`\n=== summary: ${ran} cases, ${uncaught} uncaught/malformed ===`);
process.exit(uncaught === 0 ? 0 : 1);
