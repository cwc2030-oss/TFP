import { useRef } from 'react';
import html2canvas from 'html2canvas';
import type { BackboneState } from '@/lib/listing-backbone';

interface ScoreCardProps {
  address: string;
  acres: number;
  // Real 3-state terrain backbone verdict — same source as the map + Hunt Report.
  backboneState: BackboneState;
  ridgeSpineCount: number;
  saddleCrossings: number;
  convergenceZoneCount: number;
  primaryMovement?: string;
  onClose: () => void;
}

// Verdict presentation, keyed to the ONE shared 3-state read. No score, no grade.
const VERDICT: Record<BackboneState, {
  badge: string;
  headline: string;
  accent: string;
  share: string;
}> = {
  confirmed: {
    badge: 'CONFIRMED',
    headline: 'Confirmed terrain backbone',
    accent: '#22c55e',
    share: 'TerraFirma confirmed a real terrain backbone on my land — ridge spines, saddle crossings and convergence. Read any parcel free at terrafirma.partners',
  },
  marginal: {
    badge: 'MARGINAL',
    headline: 'Marginal structure — not a full backbone',
    accent: '#f59e0b',
    share: 'TerraFirma read some terrain structure on my land — a modest spine, not a full backbone. Read any parcel free at terrafirma.partners',
  },
  flat: {
    badge: 'FLAT',
    headline: 'Flat, low-relief ground',
    accent: '#a8a29e',
    share: 'TerraFirma read the terrain on my land — gentle, low-relief ground where movement is dispersed, not funneled. Read any parcel free at terrafirma.partners',
  },
};

export default function ScoreCard({
  address,
  acres,
  backboneState,
  ridgeSpineCount,
  saddleCrossings,
  convergenceZoneCount,
  primaryMovement,
  onClose
}: ScoreCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const v = VERDICT[backboneState];
  const isFlat = backboneState === 'flat';

  async function handleShare() {
    if (!cardRef.current) return;

    const canvas = await html2canvas(cardRef.current, {
      backgroundColor: '#0a1a0a',
      scale: 2, // retina quality
      useCORS: true
    });

    // Convert to blob
    canvas.toBlob(async (blob) => {
      if (!blob) return;

      // Try native share sheet first (mobile)
      if (navigator.share) {
        const file = new File([blob], 'terrafirma-terrain.png', {
          type: 'image/png'
        });
        await navigator.share({
          title: 'My TerraFirma Terrain Read',
          text: v.share,
          files: [file]
        });
      } else {
        // Desktop fallback — download the image
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'terrafirma-terrain.png';
        a.click();
        URL.revokeObjectURL(url);
      }
    }, 'image/png');
  }

  const stats = [
    { label: 'RIDGE SPINES', value: ridgeSpineCount },
    { label: 'SADDLE CROSSINGS', value: saddleCrossings },
    { label: 'CONVERGENCE', value: convergenceZoneCount },
  ];

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center
                    justify-center z-50 p-4">

      {/* The card — this is what gets captured */}
      <div
        ref={cardRef}
        className="w-[340px] rounded-2xl p-6 relative overflow-hidden"
        style={{
          background: 'linear-gradient(135deg, #0a1a0a 0%, #1a2e1a 100%)',
          border: `1px solid ${v.accent}`,
          fontFamily: 'system-ui, sans-serif'
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <span style={{ fontSize: 24 }}>🦌</span>
            <div>
              <div style={{
                color: '#f59e0b',
                fontWeight: 700,
                fontSize: 13,
                letterSpacing: '0.1em'
              }}>
                TERRAFIRMA INTEL
              </div>
              <div style={{ color: '#6b7280', fontSize: 11 }}>
                terrafirma.partners
              </div>
            </div>
          </div>
          <div style={{
            background: v.accent,
            color: '#0a1a0a',
            fontWeight: 800,
            fontSize: 12,
            letterSpacing: '0.06em',
            padding: '7px 11px',
            borderRadius: 10,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            {v.badge}
          </div>
        </div>

        {/* Location */}
        <div style={{
          color: '#e5e7eb',
          fontSize: 14,
          fontWeight: 600,
          marginBottom: 2
        }}>
          {address}
        </div>
        <div style={{ color: '#6b7280', fontSize: 12, marginBottom: 16 }}>
          {acres.toLocaleString()} acres analyzed
        </div>

        {/* Verdict headline */}
        <div style={{
          background: '#111827',
          borderRadius: 10,
          padding: '12px 14px',
          marginBottom: 14,
          borderLeft: `3px solid ${v.accent}`
        }}>
          <div style={{ color: '#6b7280', fontSize: 11, marginBottom: 3 }}>
            TERRAIN BACKBONE
          </div>
          <div style={{
            color: v.accent,
            fontWeight: 800,
            fontSize: 16,
            lineHeight: 1.25
          }}>
            {v.headline}
          </div>
        </div>

        {/* Primary movement — only when there is real structure to move along */}
        {!isFlat && primaryMovement && (
          <div style={{
            background: '#111827',
            borderRadius: 10,
            padding: '10px 14px',
            marginBottom: 14
          }}>
            <div style={{ color: '#6b7280', fontSize: 11, marginBottom: 3 }}>
              PRIMARY MOVEMENT
            </div>
            <div style={{
              color: '#f59e0b',
              fontWeight: 700,
              fontSize: 14
            }}>
              {primaryMovement}
            </div>
          </div>
        )}

        {/* Real counts (earned states) OR an honest flat note */}
        {isFlat ? (
          <div style={{
            background: '#111827',
            borderRadius: 10,
            padding: '12px 14px',
            marginBottom: 16,
            color: '#9ca3af',
            fontSize: 12,
            lineHeight: 1.4
          }}>
            No confirmed backbone here — movement is dispersed, not funneled.
            Read the food, cover and sign on the ground.
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr',
            gap: 8,
            marginBottom: 16
          }}>
            {stats.map(stat => (
              <div key={stat.label} style={{
                background: '#111827',
                borderRadius: 8,
                padding: '8px 4px',
                textAlign: 'center'
              }}>
                <div style={{
                  color: v.accent,
                  fontWeight: 800,
                  fontSize: 18
                }}>
                  {stat.value}
                </div>
                <div style={{ color: '#6b7280', fontSize: 9 }}>
                  {stat.label}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Footer CTA */}
        <div style={{
          borderTop: '1px solid #1f2937',
          paddingTop: 12,
          textAlign: 'center'
        }}>
          <div style={{ color: '#6b7280', fontSize: 11 }}>
            Read any parcel free at
          </div>
          <div style={{
            color: '#f59e0b',
            fontWeight: 700,
            fontSize: 13
          }}>
            terrafirma.partners
          </div>
        </div>
      </div>

      {/* Action buttons — outside the card capture area */}
      <div className="absolute bottom-8 left-0 right-0
                      flex flex-col items-center gap-3 px-8">
        <button
          onClick={handleShare}
          className="w-full max-w-xs px-6 py-3 rounded-xl
                     bg-amber-600 hover:bg-amber-500
                     text-white font-bold text-base
                     transition-colors duration-200"
        >
          📤 Share My Terrain Read
        </button>
        <button
          onClick={onClose}
          className="text-gray-500 hover:text-gray-300
                     text-sm transition-colors"
        >
          Close
        </button>
      </div>
    </div>
  );
}
