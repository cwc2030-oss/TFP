/**
 * USDA Cropland Data Layer (CDL) Analysis
 * Fetches CDL raster, classifies ag/timber pixels, detects field/timber edges,
 * and finds inside corners for whitetail hunting intelligence.
 */

import { fromArrayBuffer, GeoTIFF } from 'geotiff';

// ═══════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════

export interface CDLAnalysisResult {
  agEdgeLines: GeoJSON.FeatureCollection;
  insideCorners: GeoJSON.FeatureCollection;
  soilFlags: {
    drainageClass: string;
    bedding_candidate: boolean;
    travel_corridor: boolean;
  };
  metadata: {
    year: number;
    totalPixels: number;
    agPixels: number;
    timberPixels: number;
    edgeSegments: number;
    cornerCount: number;
    resolution: number; // meters per pixel
  };
}

export type PixelClass = 'ag' | 'timber' | 'other';

export interface GeoTransform {
  originX: number; // top-left X in image CRS
  originY: number; // top-left Y in image CRS
  pixelWidth: number; // X resolution (positive)
  pixelHeight: number; // Y resolution (usually negative for north-up)
}

interface EdgeSegment {
  // Grid corner indices (NOT pixel indices)
  r1: number; c1: number;
  r2: number; c2: number;
  fieldType: string; // e.g., 'corn', 'soybeans', 'hay'
  agPixelRow: number;
  agPixelCol: number;
}

// ═══════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════

/** CDL crop codes → hunting-relevant field type */
const AG_CROPS: Record<number, string> = {
  1: 'corn',
  2: 'cotton',
  5: 'soybeans',
  6: 'sunflower',
  12: 'sweet_corn',
  21: 'barley',
  23: 'spring_wheat',
  24: 'winter_wheat',
  28: 'oats',
  36: 'alfalfa',
  37: 'hay',
  61: 'fallow',
};

/** CDL forest codes */
const TIMBER_CODES = new Set([141, 142, 143]);

// Albers Equal Area Conic (NAD83) — CDL native projection
// Manual inverse projection constants
const DEG = Math.PI / 180;
const PHI_0 = 23 * DEG;
const PHI_1 = 29.5 * DEG;
const PHI_2 = 45.5 * DEG;
const LAM_0 = -96 * DEG;

// Pre-compute Albers constants
const n_alb = (Math.sin(PHI_1) + Math.sin(PHI_2)) / 2;
const C_alb = Math.cos(PHI_1) ** 2 + 2 * n_alb * Math.sin(PHI_1);
const rho0_alb = Math.sqrt(C_alb - 2 * n_alb * Math.sin(PHI_0)) / n_alb;

/** Convert Albers (x,y) → WGS84 (lng, lat) */
function albersToWgs84(x: number, y: number): [number, number] {
  const rho = Math.sqrt(x * x + (rho0_alb - y) ** 2);
  const theta = Math.atan2(x, rho0_alb - y);
  const phi = Math.asin((C_alb - (rho * n_alb) ** 2) / (2 * n_alb));
  const lam = theta / n_alb + LAM_0;
  return [lam / DEG, phi / DEG]; // [lng, lat]
}

/** Convert WGS84 (lng, lat) → Albers (x, y) */
function wgs84ToAlbers(lng: number, lat: number): [number, number] {
  const phi = lat * DEG;
  const lam = lng * DEG;
  const rho = Math.sqrt(C_alb - 2 * n_alb * Math.sin(phi)) / n_alb;
  const theta = n_alb * (lam - LAM_0);
  return [rho * Math.sin(theta), rho0_alb - rho * Math.cos(theta)];
}

// ═══════════════════════════════════════════════════════
// STEP 1 — FETCH & PARSE CDL
// ═══════════════════════════════════════════════════════

/**
 * Fetch CDL GeoTIFF from CropScape and parse into classified pixel grid.
 * Returns null on any failure (non-blocking).
 */
export async function fetchAndParseCDL(
  bbox: [number, number, number, number], // [minLng, minLat, maxLng, maxLat] in WGS84
  year?: number,
): Promise<{
  grid: PixelClass[][];
  rawValues: number[][];
  width: number;
  height: number;
  transform: GeoTransform;
  year: number;
  agPixels: number;
  timberPixels: number;
  totalPixels: number;
} | null> {
  const targetYear = year || new Date().getFullYear() - 1;
  const [minLng, minLat, maxLng, maxLat] = bbox;

  // CropScape GetCDLFile endpoint
  const url = `https://www.nass.usda.gov/Research_and_Science/Cropland/metadata/CDL_browse_graphic_752x600.png` +
    `?GetCDLFile&year=${targetYear}` +
    `&bbox=${minLng},${minLat},${maxLng},${maxLat}` +
    `&format=GeoTiff`;

  console.log(`[CDL] Fetching CDL data: year=${targetYear}, bbox=[${bbox.join(',')}]`);

  try {
    // Step 1a: Get the TIF download URL from CropScape
    const metaRes = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: { 'Accept': 'text/xml, application/xml, */*' },
    });

    if (!metaRes.ok) {
      console.warn(`[CDL] CropScape returned ${metaRes.status}`);
      return null;
    }

    const metaText = await metaRes.text();

    // Extract the TIF URL from XML response
    const tifUrlMatch = metaText.match(/<returnReqTIFURL>(.*?)<\/returnReqTIFURL>/i)
      || metaText.match(/https?:\/\/[^"<>\s]+\.tif/i);

    if (!tifUrlMatch) {
      console.warn('[CDL] Could not extract TIF URL from CropScape response');
      return null;
    }

    const tifUrl = tifUrlMatch[1] || tifUrlMatch[0];
    console.log(`[CDL] Downloading GeoTIFF from: ${tifUrl}`);

    // Step 1b: Download the GeoTIFF
    const tifRes = await fetch(tifUrl, { signal: AbortSignal.timeout(30000) });
    if (!tifRes.ok) {
      console.warn(`[CDL] GeoTIFF download failed: ${tifRes.status}`);
      return null;
    }

    const buffer = await tifRes.arrayBuffer();
    console.log(`[CDL] GeoTIFF downloaded: ${(buffer.byteLength / 1024).toFixed(1)}KB`);

    // Step 1c: Parse the GeoTIFF
    const tiff: GeoTIFF = await fromArrayBuffer(buffer);
    const image = await tiff.getImage();
    const width = image.getWidth();
    const height = image.getHeight();
    const [originX, originY] = image.getOrigin();
    const [resX, resY] = image.getResolution();
    const rasters = await image.readRasters();
    const values = rasters[0] as Uint8Array | Uint16Array | Int16Array;

    console.log(`[CDL] Parsed raster: ${width}x${height} pixels, origin=(${originX.toFixed(1)}, ${originY.toFixed(1)}), res=(${resX.toFixed(1)}, ${resY.toFixed(1)})`);

    const transform: GeoTransform = {
      originX,
      originY,
      pixelWidth: resX,
      pixelHeight: resY, // typically negative
    };

    // Step 1d: Classify pixels
    let agPixels = 0;
    let timberPixels = 0;
    const grid: PixelClass[][] = [];
    const rawGrid: number[][] = [];

    for (let r = 0; r < height; r++) {
      const row: PixelClass[] = [];
      const rawRow: number[] = [];
      for (let c = 0; c < width; c++) {
        const val = values[r * width + c];
        rawRow.push(val);
        if (AG_CROPS[val]) {
          row.push('ag');
          agPixels++;
        } else if (TIMBER_CODES.has(val)) {
          row.push('timber');
          timberPixels++;
        } else {
          row.push('other');
        }
      }
      grid.push(row);
      rawGrid.push(rawRow);
    }

    console.log(`[CDL] Classification: ${agPixels} ag, ${timberPixels} timber, ${width * height - agPixels - timberPixels} other (total ${width * height})`);

    return {
      grid,
      rawValues: rawGrid,
      width,
      height,
      transform,
      year: targetYear,
      agPixels,
      timberPixels,
      totalPixels: width * height,
    };
  } catch (err) {
    console.warn('[CDL] Fetch/parse failed (non-blocking):', (err as Error).message);
    // Fall back to previous year on failure
    if (!year && targetYear > 2020) {
      console.log(`[CDL] Retrying with year ${targetYear - 1}...`);
      return fetchAndParseCDL(bbox, targetYear - 1);
    }
    return null;
  }
}

// ═══════════════════════════════════════════════════════
// STEP 2 — DETECT AG/TIMBER EDGES
// ═══════════════════════════════════════════════════════

/** Get the field type name for an AG pixel code */
function getFieldType(rawValue: number): string {
  return AG_CROPS[rawValue] || 'crop';
}

/**
 * Find all boundary segments where AG pixels are adjacent to TIMBER pixels.
 * Returns raw edge segments in grid-corner coordinates.
 */
function findEdgeSegments(
  grid: PixelClass[][],
  rawValues: number[][],
  width: number,
  height: number,
): EdgeSegment[] {
  const segments: EdgeSegment[] = [];

  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const cur = grid[r][c];
      if (cur !== 'ag' && cur !== 'timber') continue;

      // Check right neighbor
      if (c + 1 < width) {
        const right = grid[r][c + 1];
        if ((cur === 'ag' && right === 'timber') || (cur === 'timber' && right === 'ag')) {
          const agCol = cur === 'ag' ? c : c + 1;
          const agRow = r;
          segments.push({
            r1: r, c1: c + 1,
            r2: r + 1, c2: c + 1,
            fieldType: getFieldType(rawValues[agRow][agCol]),
            agPixelRow: agRow,
            agPixelCol: agCol,
          });
        }
      }

      // Check bottom neighbor
      if (r + 1 < height) {
        const bottom = grid[r + 1][c];
        if ((cur === 'ag' && bottom === 'timber') || (cur === 'timber' && bottom === 'ag')) {
          const agRow = cur === 'ag' ? r : r + 1;
          segments.push({
            r1: r + 1, c1: c,
            r2: r + 1, c2: c + 1,
            fieldType: getFieldType(rawValues[agRow][c]),
            agPixelRow: agRow,
            agPixelCol: c,
          });
        }
      }
    }
  }

  return segments;
}

/** Convert grid corner (row, col) to geo coordinates via GeoTransform */
function cornerToGeo(row: number, col: number, t: GeoTransform): [number, number] {
  const x = t.originX + col * t.pixelWidth;
  const y = t.originY + row * t.pixelHeight;
  // Coordinates are in Albers — convert to WGS84
  return albersToWgs84(x, y);
}

/** Haversine distance between two [lng, lat] points in meters */
function haversineM(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const dLat = (b[1] - a[1]) * DEG;
  const dLng = (b[0] - a[0]) * DEG;
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(a[1] * DEG) * Math.cos(b[1] * DEG) * sinLng * sinLng;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Compute total length of a coordinate array in meters */
function polylineLength(coords: [number, number][]): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    total += haversineM(coords[i - 1], coords[i]);
  }
  return total;
}

/**
 * Trace connected edge segments into polylines.
 * Uses adjacency graph + DFS.
 */
function tracePolylines(
  segments: EdgeSegment[],
  transform: GeoTransform,
): { coords: [number, number][]; fieldTypes: Set<string> }[] {
  if (segments.length === 0) return [];

  // Build adjacency graph: corner → list of { neighbor corner, segment index }
  const key = (r: number, c: number) => `${r},${c}`;
  const adj = new Map<string, { neighbor: string; segIdx: number }[]>();

  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    const k1 = key(s.r1, s.c1);
    const k2 = key(s.r2, s.c2);
    if (!adj.has(k1)) adj.set(k1, []);
    if (!adj.has(k2)) adj.set(k2, []);
    adj.get(k1)!.push({ neighbor: k2, segIdx: i });
    adj.get(k2)!.push({ neighbor: k1, segIdx: i });
  }

  const usedSegments = new Set<number>();
  const polylines: { coords: [number, number][]; fieldTypes: Set<string> }[] = [];

  // Find endpoints (degree 1) or pick any node to start
  const endpoints: string[] = [];
  for (const [k, neighbors] of adj) {
    const unusedCount = neighbors.filter(n => !usedSegments.has(n.segIdx)).length;
    if (unusedCount === 1) endpoints.push(k);
  }

  const startNodes = endpoints.length > 0 ? endpoints : [...adj.keys()];

  for (const start of startNodes) {
    // Check if there are unused segments from this node
    const neighbors = adj.get(start);
    if (!neighbors) continue;
    const hasUnused = neighbors.some(n => !usedSegments.has(n.segIdx));
    if (!hasUnused) continue;

    // DFS trace
    const path: string[] = [start];
    const fieldTypes = new Set<string>();
    let current = start;

    while (true) {
      const curNeighbors = adj.get(current) || [];
      const next = curNeighbors.find(n => !usedSegments.has(n.segIdx));
      if (!next) break;

      usedSegments.add(next.segIdx);
      fieldTypes.add(segments[next.segIdx].fieldType);
      path.push(next.neighbor);
      current = next.neighbor;
    }

    if (path.length < 2) continue;

    // Convert to geo coordinates
    const coords: [number, number][] = path.map(k => {
      const [r, c] = k.split(',').map(Number);
      return cornerToGeo(r, c, transform);
    });

    polylines.push({ coords, fieldTypes });
  }

  return polylines;
}

/**
 * Build agEdgeLines FeatureCollection from traced polylines.
 */
export function buildAgEdgeLines(
  segments: EdgeSegment[],
  transform: GeoTransform,
): GeoJSON.FeatureCollection {
  const polylines = tracePolylines(segments, transform);

  const features: GeoJSON.Feature[] = polylines
    .filter(p => p.coords.length >= 2)
    .map((p, i) => {
      const length = polylineLength(p.coords);
      const dominantType = [...p.fieldTypes][0] || 'crop';
      return {
        type: 'Feature' as const,
        properties: {
          id: `ag-edge-${i}`,
          fieldType: dominantType,
          fieldTypes: [...p.fieldTypes],
          edgeLength: Math.round(length),
          vertexCount: p.coords.length,
        },
        geometry: {
          type: 'LineString' as const,
          coordinates: p.coords,
        },
      };
    });

  return { type: 'FeatureCollection', features };
}

// ═══════════════════════════════════════════════════════
// STEP 3 — FIND INSIDE CORNERS
// ═══════════════════════════════════════════════════════

/**
 * Walk each edge LineString. At vertices where the interior angle < threshold,
 * flag as inside corner candidate.
 */
export function findInsideCorners(
  agEdgeLines: GeoJSON.FeatureCollection,
  angleDeg: number = 160,
): GeoJSON.FeatureCollection {
  const corners: GeoJSON.Feature[] = [];
  let idx = 0;

  for (const feature of agEdgeLines.features) {
    if (feature.geometry.type !== 'LineString') continue;
    const coords = feature.geometry.coordinates as [number, number][];
    if (coords.length < 3) continue;

    const edgeLength = feature.properties?.edgeLength || 0;
    const fieldType = feature.properties?.fieldType || 'crop';

    for (let i = 1; i < coords.length - 1; i++) {
      const prev = coords[i - 1];
      const curr = coords[i];
      const next = coords[i + 1];

      // Vectors
      const ax = curr[0] - prev[0];
      const ay = curr[1] - prev[1];
      const bx = next[0] - curr[0];
      const by = next[1] - curr[1];

      // Dot product and cross product
      const dot = ax * bx + ay * by;
      const cross = ax * by - ay * bx;
      const magA = Math.sqrt(ax * ax + ay * ay);
      const magB = Math.sqrt(bx * bx + by * by);

      if (magA === 0 || magB === 0) continue;

      const cosAngle = Math.max(-1, Math.min(1, dot / (magA * magB)));
      const angle = Math.acos(cosAngle) / DEG; // 0-180°

      // The interior angle at this vertex (supplement = 180 - turning angle)
      // angle = angle between vectors. 180° = straight. < 180° = turn.
      if (angle < angleDeg) {
        corners.push({
          type: 'Feature',
          properties: {
            id: `corner-${idx++}`,
            interiorAngle: Math.round(angle * 10) / 10,
            edgeLength: edgeLength,
            fieldType,
            // Will be enriched client-side when terrain data is available:
            nearestSaddleDistance: null,
            nearestDrawDistance: null,
            turnDirection: cross > 0 ? 'left' : 'right',
          },
          geometry: {
            type: 'Point',
            coordinates: curr,
          },
        });
      }
    }
  }

  return { type: 'FeatureCollection', features: corners };
}

// ═══════════════════════════════════════════════════════
// STEP 4 — SOIL DRAINAGE FLAGS
// ═══════════════════════════════════════════════════════

export interface SoilDrainageFlags {
  drainageClass: string;
  bedding_candidate: boolean;
  travel_corridor: boolean;
}

/** Classify soil drainage into hunting-relevant flags */
export function classifySoilDrainage(drainageClass: string): SoilDrainageFlags {
  const lower = (drainageClass || '').toLowerCase();
  const isPoorlyDrained = lower.includes('poorly') || lower.includes('very poorly');
  const isWellDrained = (lower.includes('well drained') && !lower.includes('somewhat'))
    || lower.includes('excessively');

  return {
    drainageClass,
    bedding_candidate: isPoorlyDrained,
    travel_corridor: isWellDrained,
  };
}

/**
 * Cross-reference CDL edges with soil drainage data.
 * Tags edge features with premium_transition when well-drained field edge
 * meets poorly-drained adjacent timber.
 *
 * For Part 1, we use the parcel-level drainage class as a proxy.
 * A more sophisticated version would use spatial soil polygon data.
 */
export function crossReferenceSoilWithEdges(
  agEdgeLines: GeoJSON.FeatureCollection,
  parcelDrainageClass: string,
  adjacentTimberDrainageClass?: string,
): GeoJSON.FeatureCollection {
  const parcelFlags = classifySoilDrainage(parcelDrainageClass);
  const timberFlags = adjacentTimberDrainageClass
    ? classifySoilDrainage(adjacentTimberDrainageClass)
    : null;

  // Premium transition: well-drained AG side + poorly-drained TIMBER side
  // Without spatial soil polygons, we approximate: if parcel is well-drained
  // and adjacent area drainage class is poorly drained, flag edges.
  const isPremium = parcelFlags.travel_corridor && (timberFlags?.bedding_candidate ?? false);

  const enrichedFeatures = agEdgeLines.features.map(f => ({
    ...f,
    properties: {
      ...f.properties,
      soil_bedding_candidate: parcelFlags.bedding_candidate,
      soil_travel_corridor: parcelFlags.travel_corridor,
      premium_transition: isPremium,
    },
  }));

  return { type: 'FeatureCollection', features: enrichedFeatures };
}

// ═══════════════════════════════════════════════════════
// MAIN ENTRY POINT
// ═══════════════════════════════════════════════════════

/**
 * Full CDL analysis pipeline.
 * Returns null on failure (non-blocking).
 */
export async function analyzeCDL(
  bbox: [number, number, number, number],
  drainageClass: string,
  year?: number,
): Promise<CDLAnalysisResult | null> {
  // Step 1: Fetch and parse
  const parsed = await fetchAndParseCDL(bbox, year);
  if (!parsed) return null;

  // Step 2: Detect edges
  const segments = findEdgeSegments(parsed.grid, parsed.rawValues, parsed.width, parsed.height);
  const agEdgeLines = buildAgEdgeLines(segments, parsed.transform);
  console.log(`[CDL] Edge detection: ${segments.length} raw segments → ${agEdgeLines.features.length} polylines`);

  // Step 3: Find inside corners
  const insideCorners = findInsideCorners(agEdgeLines, 160);
  console.log(`[CDL] Inside corners: ${insideCorners.features.length} candidates (angle < 160°)`);

  // Step 4: Soil drainage flags
  const soilFlags = classifySoilDrainage(drainageClass);
  const enrichedEdges = crossReferenceSoilWithEdges(agEdgeLines, drainageClass);

  // Compute resolution from transform (approximate meters per pixel)
  const centerRow = Math.floor(parsed.height / 2);
  const centerCol = Math.floor(parsed.width / 2);
  const p1 = cornerToGeo(centerRow, centerCol, parsed.transform);
  const p2 = cornerToGeo(centerRow, centerCol + 1, parsed.transform);
  const resolution = Math.round(haversineM(p1, p2));

  return {
    agEdgeLines: enrichedEdges,
    insideCorners,
    soilFlags,
    metadata: {
      year: parsed.year,
      totalPixels: parsed.totalPixels,
      agPixels: parsed.agPixels,
      timberPixels: parsed.timberPixels,
      edgeSegments: segments.length,
      cornerCount: insideCorners.features.length,
      resolution,
    },
  };
}
