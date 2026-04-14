import { useRef } from 'react';
import html2canvas from 'html2canvas';

interface ScoreCardProps {
  address: string;
  acres: number;
  score: number;
  grade: string;
  primaryMovement: string;
  funnelCount: number;
  standCount: number;
  bedAcres: number;
  onClose: () => void;
}

export default function ScoreCard({
  address,
  acres,
  score,
  grade,
  primaryMovement,
  funnelCount,
  standCount,
  bedAcres,
  onClose
}: ScoreCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);

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
        const file = new File([blob], 'terrafirma-score.png', { 
          type: 'image/png' 
        });
        await navigator.share({
          title: 'My TerraFirma Terrain Score',
          text: `My land scored ${score}/100 on TerraFirma. Find your intercept point free at terrafirma.partners`,
          files: [file]
        });
      } else {
        // Desktop fallback — download the image
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'terrafirma-score.png';
        a.click();
        URL.revokeObjectURL(url);
      }
    }, 'image/png');
  }

  // Grade to color mapping
  const gradeColor = {
    'A+': '#22c55e', 'A': '#22c55e',
    'B+': '#84cc16', 'B': '#84cc16',
    'C+': '#f59e0b', 'C': '#f59e0b',
    'D':  '#ef4444'
  }[grade] ?? '#f59e0b';

  // Score bar fill percentage
  const scorePct = Math.min(100, Math.max(0, score));

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center 
                    justify-center z-50 p-4">
      
      {/* The card — this is what gets captured */}
      <div
        ref={cardRef}
        className="w-[340px] rounded-2xl p-6 relative overflow-hidden"
        style={{ 
          background: 'linear-gradient(135deg, #0a1a0a 0%, #1a2e1a 100%)',
          border: '1px solid #f59e0b',
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
            background: gradeColor,
            color: 'white',
            fontWeight: 800,
            fontSize: 22,
            width: 48,
            height: 48,
            borderRadius: 12,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            {grade}
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

        {/* Score bar */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between',
            marginBottom: 6
          }}>
            <span style={{ color: '#9ca3af', fontSize: 12 }}>
              TERRAIN SCORE
            </span>
            <span style={{ 
              color: gradeColor, 
              fontWeight: 800, 
              fontSize: 20 
            }}>
              {score}/100
            </span>
          </div>
          <div style={{ 
            background: '#1f2937', 
            borderRadius: 99, 
            height: 8,
            overflow: 'hidden'
          }}>
            <div style={{
              width: `${scorePct}%`,
              height: '100%',
              background: `linear-gradient(90deg, #f59e0b, ${gradeColor})`,
              borderRadius: 99,
              transition: 'width 1s ease'
            }} />
          </div>
        </div>

        {/* Primary movement */}
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

        {/* Stats grid */}
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: '1fr 1fr 1fr 1fr',
          gap: 8,
          marginBottom: 16
        }}>
          {[
            { label: 'FUNNELS', value: funnelCount },
            { label: 'STANDS', value: standCount },
            { label: 'BED AC', value: bedAcres },
            { label: 'SCORE', value: score }
          ].map(stat => (
            <div key={stat.label} style={{
              background: '#111827',
              borderRadius: 8,
              padding: '8px 4px',
              textAlign: 'center'
            }}>
              <div style={{ 
                color: '#f59e0b', 
                fontWeight: 800, 
                fontSize: 16 
              }}>
                {stat.value}
              </div>
              <div style={{ color: '#6b7280', fontSize: 9 }}>
                {stat.label}
              </div>
            </div>
          ))}
        </div>

        {/* Footer CTA */}
        <div style={{
          borderTop: '1px solid #1f2937',
          paddingTop: 12,
          textAlign: 'center'
        }}>
          <div style={{ color: '#6b7280', fontSize: 11 }}>
            Find your intercept point free at
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
          📤 Share My Score
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
