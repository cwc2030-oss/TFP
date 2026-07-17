/**
 * parcel-listing-image.ts
 *
 * Auto-generates a PUBLIC parcel-shape listing image so a landowner can
 * publish a hunt-lease listing with ZERO uploaded photos. The image shows
 * the parcel OUTLINE (brand emerald) on a neutral dark-stone branded
 * background, plus an acreage label, optional "County, ST", and a small
 * "Terrain Certified" mark.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * OPSEC (this image is PUBLIC — hard requirements):
 *   • Neutral/branded background ONLY. No satellite, no basemap, no roads,
 *     no place labels, no town names.
 *   • NO coordinates anywhere: no lat/lng, no georeferenced axes, no scale
 *     bar, no true-north arrow.
 *   • The polygon is NORMALIZED before drawing — centered, scaled-to-fit,
 *     rotated to a canonical (PCA) orientation, and deterministically
 *     de-mirrored — so the outline is NOT a georeferenced tracing that could
 *     be reverse-matched against public parcel databases.
 *   • Output is a freshly-encoded PNG (via next/og → resvg). It carries no
 *     EXIF/GPS and no embedded coordinates. The parcels JSON is never
 *     embedded or exposed.
 *   • County/state text is allowed (county-level is OPSEC-safe); precise
 *     location is not.
 *
 * FALLBACK: if parcel geometry is missing/degenerate, we render a data-only
 * "Terrain Certified" card (grade / acres / county) rather than block publish.
 * ─────────────────────────────────────────────────────────────────────────
 */
import { ImageResponse } from 'next/og';
import type { SavedProperty } from '@prisma/client';
import { prisma } from '@/lib/db';
import { uploadToS3 } from '@/lib/s3';
import { gradeFromScore } from '@/lib/listings';

// 16:10 — safe for the public hero (16/9 & 16/10 crops) and square thumbs.
const CANVAS_W = 1600;
const CANVAS_H = 1000;
// Inner drawing box for the polygon (leaves room for label chrome).
const PAD_X = 190;
const PAD_TOP = 150;
const PAD_BOTTOM = 250;

// Brand palette
const EMERALD = '#10b981';
const EMERALD_SOFT = 'rgba(16,185,129,0.10)';
const STONE_900 = '#1c1917';
const STONE_800 = '#292524';

type Ring = number[][]; // array of [lng, lat]

// ---------------------------------------------------------------------------
// Geometry extraction
// ---------------------------------------------------------------------------

/**
 * Pull every polygon ring (exterior + interior/holes) out of a
 * SavedProperty.parcels JSON value. Each parcel entry is expected to carry a
 * GeoJSON `geometry` of type Polygon or MultiPolygon with [lng, lat] coords.
 */
export function extractParcelRings(parcels: unknown): Ring[] {
  const rings: Ring[] = [];
  if (!Array.isArray(parcels)) return rings;

  const pushPolygon = (poly: unknown) => {
    if (!Array.isArray(poly)) return;
    for (const ring of poly as unknown[]) {
      if (!Array.isArray(ring)) continue;
      const clean: number[][] = [];
      for (const pt of ring as unknown[]) {
        if (
          Array.isArray(pt) &&
          pt.length >= 2 &&
          typeof pt[0] === 'number' &&
          typeof pt[1] === 'number' &&
          Number.isFinite(pt[0]) &&
          Number.isFinite(pt[1])
        ) {
          clean.push([pt[0], pt[1]]);
        }
      }
      if (clean.length >= 3) rings.push(clean);
    }
  };

  // Unwrap a GeoJSON node down to a bare Polygon/MultiPolygon geometry.
  // SavedProperty.parcels entries store `geometry` as either a bare geometry
  // or a GeoJSON Feature ({ type:'Feature', geometry:{...} }) / FeatureCollection.
  const resolveGeometry = (node: any, depth = 0): any => {
    if (!node || typeof node !== 'object' || depth > 4) return null;
    if (node.type === 'Polygon' || node.type === 'MultiPolygon') return node;
    if (node.type === 'Feature') return resolveGeometry(node.geometry, depth + 1);
    if (node.type === 'FeatureCollection' && Array.isArray(node.features)) {
      // Return a synthetic MultiPolygon-ish wrapper handled by caller loop.
      return { type: 'FeatureCollection', features: node.features };
    }
    if (node.geometry) return resolveGeometry(node.geometry, depth + 1);
    return null;
  };

  const ingest = (g: any, depth = 0) => {
    if (!g || depth > 4) return;
    if (g.type === 'FeatureCollection' && Array.isArray(g.features)) {
      for (const f of g.features) ingest(resolveGeometry(f), depth + 1);
      return;
    }
    if (!g.coordinates) return;
    if (g.type === 'Polygon') {
      pushPolygon(g.coordinates);
    } else if (g.type === 'MultiPolygon') {
      for (const poly of g.coordinates as unknown[]) pushPolygon(poly);
    }
  };

  for (const item of parcels) {
    if (!item || typeof item !== 'object') continue;
    ingest(resolveGeometry((item as any).geometry ?? item));
  }
  return rings;
}

// ---------------------------------------------------------------------------
// OPSEC normalization: center → project → PCA-rotate → de-mirror → scale-to-fit
// ---------------------------------------------------------------------------

type Pt = { x: number; y: number };

/**
 * Normalize parcel rings into canvas-pixel paths. Returns null when the
 * geometry is missing or degenerate (zero-area / single point).
 *
 * The transform intentionally discards all georeference:
 *   1. Equirectangular local projection (x scaled by cos(lat)) to preserve
 *      real proportions without carrying absolute coordinates.
 *   2. Translate to centroid-origin.
 *   3. Rotate by the negative principal-axis angle (PCA) so the shape's long
 *      axis is horizontal — removes true-north alignment.
 *   4. Deterministic de-mirror using third-moment (skew) signs — removes the
 *      PCA 180°/reflection ambiguity so orientation is canonical and stable,
 *      never a 1:1 north-up tracing.
 *   5. Scale-to-fit the inner box, preserving aspect ratio, centered.
 */
export function normalizeRingsToPaths(rings: Ring[]): string[] | null {
  if (!rings.length) return null;

  // Flatten for stats.
  const all: number[][] = [];
  for (const r of rings) for (const p of r) all.push(p);
  if (all.length < 3) return null;

  const meanLat =
    all.reduce((s, p) => s + p[1], 0) / all.length;
  const cosLat = Math.cos((meanLat * Math.PI) / 180) || 1e-6;

  // Project to local planar space.
  const proj: Pt[][] = rings.map((r) =>
    r.map(([lng, lat]) => ({ x: lng * cosLat, y: lat })),
  );
  const flat: Pt[] = [];
  for (const r of proj) for (const p of r) flat.push(p);

  const cx = flat.reduce((s, p) => s + p.x, 0) / flat.length;
  const cy = flat.reduce((s, p) => s + p.y, 0) / flat.length;

  // Center.
  for (const r of proj) for (const p of r) {
    p.x -= cx;
    p.y -= cy;
  }

  // PCA principal-axis angle.
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of flat) {
    sxx += p.x * p.x;
    syy += p.y * p.y;
    sxy += p.x * p.y;
  }
  const n = flat.length;
  sxx /= n;
  syy /= n;
  sxy /= n;
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);

  const cosT = Math.cos(-theta);
  const sinT = Math.sin(-theta);
  for (const r of proj) for (const p of r) {
    const nx = p.x * cosT - p.y * sinT;
    const ny = p.x * sinT + p.y * cosT;
    p.x = nx;
    p.y = ny;
  }

  // Ensure the long axis is horizontal.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of flat) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  if (maxY - minY > maxX - minX) {
    // rotate 90°
    for (const r of proj) for (const p of r) {
      const nx = -p.y;
      const ny = p.x;
      p.x = nx;
      p.y = ny;
    }
  }

  // Deterministic de-mirror via third-moment signs.
  let m3x = 0;
  let m3y = 0;
  for (const p of flat) {
    m3x += p.x * p.x * p.x;
    m3y += p.y * p.y * p.y;
  }
  const flipX = m3x < 0 ? -1 : 1;
  const flipY = m3y < 0 ? -1 : 1;
  if (flipX < 0 || flipY < 0) {
    for (const r of proj) for (const p of r) {
      p.x *= flipX;
      p.y *= flipY;
    }
  }

  // Recompute bbox after all transforms.
  minX = Infinity;
  minY = Infinity;
  maxX = -Infinity;
  maxY = -Infinity;
  for (const p of flat) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const bboxW = maxX - minX;
  const bboxH = maxY - minY;
  if (!(bboxW > 0) || !(bboxH > 0)) return null; // degenerate

  const innerW = CANVAS_W - PAD_X * 2;
  const innerH = CANVAS_H - PAD_TOP - PAD_BOTTOM;
  const scale = Math.min(innerW / bboxW, innerH / bboxH);
  const drawnW = bboxW * scale;
  const drawnH = bboxH * scale;
  const offX = PAD_X + (innerW - drawnW) / 2;
  const offY = PAD_TOP + (innerH - drawnH) / 2;

  const toPx = (p: Pt) => {
    const px = offX + (p.x - minX) * scale;
    // Flip Y for SVG (y grows downward); direction is arbitrary post-rotation.
    const py = offY + (drawnH - (p.y - minY) * scale);
    return `${px.toFixed(1)},${py.toFixed(1)}`;
  };

  const paths: string[] = [];
  for (const r of proj) {
    if (r.length < 3) continue;
    const d = 'M' + r.map(toPx).join('L') + 'Z';
    paths.push(d);
  }
  return paths.length ? paths : null;
}

// ---------------------------------------------------------------------------
// SVG builder (background + normalized polygon). No text, no coordinates.
// ---------------------------------------------------------------------------

function buildParcelSvg(paths: string[]): string {
  const body = paths
    .map(
      (d) =>
        `<path d="${d}" fill="${EMERALD_SOFT}" fill-rule="evenodd" stroke="${EMERALD}" stroke-width="9" stroke-linejoin="round" stroke-linecap="round"/>`,
    )
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS_W}" height="${CANVAS_H}" viewBox="0 0 ${CANVAS_W} ${CANVAS_H}">` +
    `<defs><radialGradient id="bg" cx="50%" cy="38%" r="75%">` +
    `<stop offset="0%" stop-color="${STONE_800}"/><stop offset="100%" stop-color="${STONE_900}"/>` +
    `</radialGradient></defs>` +
    `<rect width="${CANVAS_W}" height="${CANVAS_H}" fill="url(#bg)"/>` +
    body +
    `</svg>`;
}

function svgDataUri(svg: string): string {
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
}

// ---------------------------------------------------------------------------
// Label helpers
// ---------------------------------------------------------------------------

function acresLabel(acres: number | null | undefined): string {
  if (acres == null || !Number.isFinite(acres) || acres <= 0) {
    return 'Acreage pending';
  }
  if (acres < 10) return `${acres.toFixed(1)} acres`;
  return `${Math.round(acres).toLocaleString('en-US')} acres`;
}

function regionLabel(
  county: string | null | undefined,
  state: string | null | undefined,
): string | null {
  const parts = [county, state].filter(
    (x): x is string => !!x && x.trim().length > 0,
  );
  return parts.length ? parts.join(', ') : null;
}

// ---------------------------------------------------------------------------
// PNG render (shape image or data-only fallback card)
// ---------------------------------------------------------------------------

export interface ListingImageInput {
  paths: string[] | null; // null → fallback card
  acres: number | null | undefined;
  county: string | null | undefined;
  state: string | null | undefined;
  terrainScore?: number | null;
}

export async function renderListingImagePng(
  input: ListingImageInput,
): Promise<Buffer> {
  const region = regionLabel(input.county, input.state);
  const acres = acresLabel(input.acres);
  const hasShape = !!input.paths && input.paths.length > 0;
  // ── PHASE 1 KILL-SWITCH (Jul 17 2026): drop the non-discriminating v1
  // "Terrain Certified" chip + letter grade from the social/OG listing image
  // until the gate-real rebuild (Phase 2) wires the backbone verdict.
  const HIDE_FAB = true;

  // "Terrain Certified" chip, shared by both variants.
  const certifiedChip = {
    type: 'div',
    props: {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '10px 22px',
        borderRadius: '999px',
        border: `2px solid ${EMERALD}`,
        color: EMERALD,
        fontSize: '26px',
        fontWeight: 700,
        letterSpacing: '2px',
        textTransform: 'uppercase',
      },
      children: [
        {
          type: 'div',
          props: {
            style: {
              display: 'flex',
              width: '16px',
              height: '16px',
              borderRadius: '999px',
              backgroundColor: EMERALD,
            },
          },
        },
        'Terrain Certified',
      ],
    },
  };

  const children: any[] = [];

  if (hasShape) {
    const svg = buildParcelSvg(input.paths as string[]);
    children.push({
      type: 'img',
      props: {
        src: svgDataUri(svg),
        width: CANVAS_W,
        height: CANVAS_H,
        style: { position: 'absolute', top: 0, left: 0 },
      },
    });
  }

  // Top-left brand eyebrow.
  children.push({
    type: 'div',
    props: {
      style: {
        position: 'absolute',
        top: '54px',
        left: '70px',
        display: 'flex',
        color: '#a8a29e',
        fontSize: '28px',
        fontWeight: 600,
        letterSpacing: '4px',
        textTransform: 'uppercase',
      },
      children: 'Terra Firma Partners',
    },
  });

  if (hasShape) {
    // Bottom band: acreage + region on the left, certified chip on the right.
    children.push({
      type: 'div',
      props: {
        style: {
          position: 'absolute',
          bottom: '58px',
          left: '70px',
          right: '70px',
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
        },
        children: [
          {
            type: 'div',
            props: {
              style: { display: 'flex', flexDirection: 'column' },
              children: [
                {
                  type: 'div',
                  props: {
                    style: {
                      display: 'flex',
                      color: '#ffffff',
                      fontSize: '84px',
                      fontWeight: 700,
                      lineHeight: 1,
                    },
                    children: acres,
                  },
                },
                ...(region
                  ? [
                      {
                        type: 'div',
                        props: {
                          style: {
                            display: 'flex',
                            marginTop: '14px',
                            color: '#d6d3d1',
                            fontSize: '36px',
                            fontWeight: 500,
                          },
                          children: region,
                        },
                      },
                    ]
                  : []),
              ],
            },
          },
          ...(HIDE_FAB ? [] : [certifiedChip]),
        ],
      },
    });
  } else {
    // Data-only fallback card — centered stack.
    const grade = gradeFromScore(input.terrainScore ?? null);
    const cardChildren: any[] = [];
    if (!HIDE_FAB && grade && grade !== '\u2014') {
      cardChildren.push({
        type: 'div',
        props: {
          style: {
            display: 'flex',
            color: EMERALD,
            fontSize: '150px',
            fontWeight: 700,
            lineHeight: 1,
          },
          children: grade,
        },
      });
      cardChildren.push({
        type: 'div',
        props: {
          style: {
            display: 'flex',
            marginTop: '6px',
            color: '#a8a29e',
            fontSize: '28px',
            fontWeight: 600,
            letterSpacing: '3px',
            textTransform: 'uppercase',
          },
          children: 'Terrain Grade',
        },
      });
    }
    cardChildren.push({
      type: 'div',
      props: {
        style: {
          display: 'flex',
          marginTop: '40px',
          color: '#ffffff',
          fontSize: '76px',
          fontWeight: 700,
        },
        children: acres,
      },
    });
    if (region) {
      cardChildren.push({
        type: 'div',
        props: {
          style: {
            display: 'flex',
            marginTop: '12px',
            color: '#d6d3d1',
            fontSize: '36px',
            fontWeight: 500,
          },
          children: region,
        },
      });
    }
    cardChildren.push({
      type: 'div',
      props: {
        style: { display: 'flex', marginTop: '46px' },
        children: [certifiedChip],
      },
    });

    children.push({
      type: 'div',
      props: {
        style: {
          position: 'absolute',
          top: 0,
          left: 0,
          width: `${CANVAS_W}px`,
          height: `${CANVAS_H}px`,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
        },
        children: cardChildren,
      },
    });
  }

  const root = {
    type: 'div',
    props: {
      style: {
        display: 'flex',
        position: 'relative',
        width: `${CANVAS_W}px`,
        height: `${CANVAS_H}px`,
        backgroundColor: STONE_900,
      },
      children,
    },
  };

  const resp = new ImageResponse(root as any, {
    width: CANVAS_W,
    height: CANVAS_H,
  });
  const ab = await resp.arrayBuffer();
  return Buffer.from(ab);
}

// ---------------------------------------------------------------------------
// Orchestration: generate + upload + attach as photo #1 (idempotent).
// ---------------------------------------------------------------------------

interface AttachableListing {
  id: string;
  photos: string[];
  county: string | null;
  state: string | null;
}

/** The fixed cloud-storage key suffix for our auto-generated listing image. */
const AUTO_IMAGE_SUFFIX = '/parcel-shape.png';

/** True if `url` is one of our auto-generated parcel-shape images. */
export function isAutoParcelImage(url: string | null | undefined): boolean {
  return typeof url === 'string' && url.includes(AUTO_IMAGE_SUFFIX);
}

/**
 * If the listing has no photos, generate the parcel-shape image (or fallback
 * card) from the anchored SavedProperty geometry, upload it to public cloud
 * storage, and set it as photo #1. Idempotent and best-effort: returns the
 * new photos array on success, or null when nothing was changed / on any
 * failure (callers must treat this as non-fatal so publish is never blocked).
 */
export async function ensureAutoListingImage(
  listing: AttachableListing,
  sp: SavedProperty,
): Promise<string[] | null> {
  try {
    const existing = Array.isArray(listing.photos) ? listing.photos : [];
    // Generate when there are no photos, OR when the only photo is our own
    // auto-generated image (so publish can refresh it now that county/state
    // are known). Never overwrite owner-uploaded photos.
    const onlyAuto = existing.length === 1 && isAutoParcelImage(existing[0]);
    if (existing.length > 0 && !onlyAuto) {
      return null;
    }

    const rings = extractParcelRings(sp.parcels);
    const paths = normalizeRingsToPaths(rings);

    const buffer = await renderListingImagePng({
      paths,
      acres: sp.totalAcres,
      county: listing.county,
      state: listing.state,
      terrainScore: sp.terrainScore,
    });

    const key = `listings/${listing.id}${AUTO_IMAGE_SUFFIX}`;
    // Cache-bust: the S3 object is overwritten in place on regeneration, so a
    // stable URL would be cached stale. A version query keeps CDN/browsers honest.
    const { url } = await uploadToS3(key, buffer, 'image/png', true);
    const versionedUrl = `${url}?v=${Date.now()}`;

    const photos = [versionedUrl];
    await prisma.listing.update({
      where: { id: listing.id },
      data: { photos },
    });
    return photos;
  } catch (e) {
    console.warn('[ParcelImage] auto-generate failed (non-fatal):', e);
    return null;
  }
}
