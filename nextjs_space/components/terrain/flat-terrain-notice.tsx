'use client';

import { Wind, Footprints } from 'lucide-react';

/**
 * FlatTerrainNotice — the consolidated, dignified empty state for a genuinely
 * FLAT verdict (terrainState === 'flat', reliefMeasured === false, analysis
 * SUCCEEDED). It replaces three scattered half-statements that used to fire for
 * the same parcel:
 *   1. Deer Flow panel  -> "Not detected on this parcel / too flat or uniform"
 *   2. Terrain Story    -> "Gentle, low-relief terrain — limited structural funneling"
 *   3. Structural bars  -> four 0% "Not detected" driver bars
 *
 * ...into ONE honest statement. It says exactly what the tool sees (no terrain
 * funneling) and stays in its lane: it never calls the land "unhuntable" and
 * never renders a verdict on the parcel's hunting value, because the Terrain
 * Brain reads TERRAIN — not food, cover, or deer.
 */
export default function FlatTerrainNotice() {
  return (
    <div className="bg-stone-900/90 border border-stone-700/50 rounded-lg overflow-hidden">
      {/* Header — states what the tool sees, plainly */}
      <div className="px-3 py-2 border-b border-stone-700/50">
        <div className="flex items-center gap-2">
          <Wind className="h-4 w-4 text-cyan-400" />
          <span className="text-sm font-semibold text-white">No terrain-driven movement</span>
        </div>
        <p className="text-[11px] text-stone-300 mt-1">
          Gentle, low-relief ground — deer move dispersed, not funneled by terrain.
        </p>
      </div>

      {/* What the tool actually found */}
      <div className="p-3 space-y-2.5">
        <p className="text-[11px] leading-relaxed text-stone-300">
          The Terrain Brain scanned this parcel and found no ridge backbone,
          saddle, or pinch point to concentrate movement. On ground like this,
          travel is <span className="text-stone-100 font-medium">dispersed rather than funneled</span> —
          there is no terrain structure to read.
        </p>

        {/* Stay-in-lane guidance — a read on the land's SHAPE, not its value */}
        <div className="flex gap-2 rounded-md bg-emerald-950/30 border border-emerald-800/30 px-2.5 py-2">
          <Footprints className="h-3.5 w-3.5 text-emerald-400 shrink-0 mt-0.5" />
          <p className="text-[11px] leading-relaxed text-stone-300">
            That&rsquo;s a read on the land&rsquo;s <span className="text-emerald-300 font-medium">shape</span>,
            not its hunting value. This tool maps terrain &mdash; not food, cover,
            or deer. Hunt this ground by the{' '}
            <span className="text-emerald-300 font-medium">food, cover edges, and fresh sign</span>{' '}
            rather than terrain funnels.
          </p>
        </div>
      </div>
    </div>
  );
}
