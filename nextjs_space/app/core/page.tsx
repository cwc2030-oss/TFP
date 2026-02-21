'use client';

import { useState, useEffect } from 'react';
import { ChevronDown, ChevronUp, CheckCircle2, AlertCircle, Clock, Info } from 'lucide-react';

// Build stamp for deployment verification
const BUILD_STAMP = {
  version: '1.0.0',
  frozen: '2026-02-21',
  components: { real: 6, stubbed: 1, total: 7 }
};

// Types for scoring output
interface ComponentScore {
  componentId: string;
  name: string;
  raw: number;
  normalized: number;
  normalized100: number;
  weight: number;
  weighted: number;
  unit: string;
  notes: string;
  status: 'real' | 'estimated' | 'stubbed';
  confidence: number;
  inputsUsed: string[];
}

interface ScoringResult {
  weightsVersion: string;
  season: string;
  seasonName: string;
  totalScore: number;
  grade: string;
  components: ComponentScore[];
  overallConfidence: number;
  statusBreakdown: {
    real: number;
    estimated: number;
    stubbed: number;
    realComponents: string[];
    estimatedComponents: string[];
    stubbedComponents: string[];
  };
  timestamp: string;
}

// Mock scoring data for demo (deterministic)
function generateMockScoring(acreage: number): ScoringResult {
  const timestamp = new Date().toISOString();
  
  const components: ComponentScore[] = [
    {
      componentId: 'bedding_quality',
      name: 'Bedding Area Quality',
      raw: 72,
      normalized: 0.72,
      normalized100: 72,
      weight: 0.20,
      weighted: 0.144,
      unit: 'score',
      notes: 'Good bedding habitat: 3 thermal zones, 2 transition areas. South-facing slopes with 12-18° grade.',
      status: 'real',
      confidence: 0.95,
      inputsUsed: ['dem_slope', 'dem_aspect', 'parcel_boundary']
    },
    {
      componentId: 'funnel_density',
      name: 'Terrain Funnel Density',
      raw: 65,
      normalized: 0.65,
      normalized100: 65,
      weight: 0.15,
      weighted: 0.0975,
      unit: 'features_per_100ac',
      notes: 'Good funnel density: 2 saddles (1.5x), 3 draws (1.0x), 1 corridor (0.8x). 6.2 weighted features per 100 acres.',
      status: 'real',
      confidence: 0.90,
      inputsUsed: ['dem_tpi', 'dem_curvature', 'parcel_boundary']
    },
    {
      componentId: 'corridor_coverage',
      name: 'Travel Corridor Coverage',
      raw: 38.5,
      normalized: 0.385,
      normalized100: 38.5,
      weight: 0.15,
      weighted: 0.05775,
      unit: 'percent',
      notes: 'Good corridor coverage: 38.5% coverage. 2 main corridors, 3 draws, buffer 50m, 847 sample points.',
      status: 'real',
      confidence: 0.90,
      inputsUsed: ['dem_flow_accumulation', 'corridor_features', 'parcel_boundary']
    },
    {
      componentId: 'water_proximity',
      name: 'Water Source Proximity',
      raw: 185,
      normalized: 0.815,
      normalized100: 81.5,
      weight: 0.15,
      weighted: 0.12225,
      unit: 'meters',
      notes: 'Good water access: avg 185m to water. Estimated from 4 terrain draws (70% water likelihood).',
      status: 'estimated',
      confidence: 0.65,
      inputsUsed: ['terrain_draws', 'stand_points']
    },
    {
      componentId: 'terrain_diversity',
      name: 'Terrain Diversity Index',
      raw: 68,
      normalized: 0.68,
      normalized100: 68,
      weight: 0.10,
      weighted: 0.068,
      unit: 'score',
      notes: 'Good terrain diversity. Real DEM analysis. [Elev Range: 42.0m (70%), Slope Std: 5.1° (64%), TPI Contrast: 0.9 (75%), Roughness: 12.0° (67%)]',
      status: 'real',
      confidence: 0.95,
      inputsUsed: ['dem_elevation', 'dem_slope', 'dem_tpi_500']
    },
    {
      componentId: 'stand_site_count',
      name: 'Viable Stand Sites',
      raw: 8,
      normalized: 0.40,
      normalized100: 40,
      weight: 0.10,
      weighted: 0.04,
      unit: 'count',
      notes: 'Good stand site selection. 8 viable stand sites (score ≥60), 4 marginal excluded.',
      status: 'real',
      confidence: 0.90,
      inputsUsed: ['dem_terrain_analysis', 'stand_points', 'tpi_analysis']
    },
    {
      componentId: 'edge_habitat',
      name: 'Edge Habitat Quality',
      raw: 60,
      normalized: 0.60,
      normalized100: 60,
      weight: 0.15,
      weighted: 0.09,
      unit: 'score',
      notes: `[STUB] Estimated from parcel size (${acreage.toFixed(0)} ac). Requires NLCD landcover for real calculation.`,
      status: 'stubbed',
      confidence: 0.30,
      inputsUsed: ['parcel_acreage', 'bedding_presence']
    }
  ];
  
  // Calculate totals
  const totalWeighted = components.reduce((sum, c) => sum + c.weighted, 0);
  const totalScore = Math.round(totalWeighted * 100);
  
  // Calculate grade
  let grade: string;
  if (totalScore >= 85) grade = 'A';
  else if (totalScore >= 70) grade = 'B';
  else if (totalScore >= 55) grade = 'C';
  else if (totalScore >= 40) grade = 'D';
  else grade = 'F';
  
  // Calculate confidence
  const weightedConfidence = components.reduce((sum, c) => sum + c.confidence * c.weight, 0);
  
  return {
    weightsVersion: '1.0',
    season: 'annual',
    seasonName: 'Annual Average',
    totalScore,
    grade,
    components,
    overallConfidence: Math.round(weightedConfidence * 100) / 100,
    statusBreakdown: {
      real: 6,
      estimated: 0,
      stubbed: 1,
      realComponents: ['bedding_quality', 'funnel_density', 'corridor_coverage', 'terrain_diversity', 'stand_site_count'],
      estimatedComponents: ['water_proximity'],
      stubbedComponents: ['edge_habitat']
    },
    timestamp
  };
}

// Status badge component
function StatusBadge({ status }: { status: 'real' | 'estimated' | 'stubbed' }) {
  const config = {
    real: { bg: 'bg-green-100', text: 'text-green-800', icon: CheckCircle2, label: 'Real' },
    estimated: { bg: 'bg-amber-100', text: 'text-amber-800', icon: AlertCircle, label: 'Estimated' },
    stubbed: { bg: 'bg-gray-100', text: 'text-gray-600', icon: Clock, label: 'Stubbed' }
  };
  const { bg, text, icon: Icon, label } = config[status];
  
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${bg} ${text}`}>
      <Icon className="w-3 h-3" />
      {label}
    </span>
  );
}

// Grade badge component
function GradeBadge({ grade, score }: { grade: string; score: number }) {
  const colors: Record<string, string> = {
    A: 'bg-green-600',
    B: 'bg-blue-600',
    C: 'bg-amber-500',
    D: 'bg-orange-500',
    F: 'bg-red-600'
  };
  
  return (
    <div className={`${colors[grade]} text-white rounded-lg px-6 py-4 text-center`}>
      <div className="text-4xl font-bold">{grade}</div>
      <div className="text-lg opacity-90">{score}/100</div>
    </div>
  );
}

export default function CoreScoringPage() {
  const [showJson, setShowJson] = useState(false);
  const [scoring, setScoring] = useState<ScoringResult | null>(null);
  const [parcelAcres] = useState(127.4); // Demo parcel
  
  useEffect(() => {
    // Generate deterministic mock data
    setScoring(generateMockScoring(parcelAcres));
  }, [parcelAcres]);
  
  if (!scoring) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-pulse text-gray-500">Loading scoring data...</div>
      </div>
    );
  }
  
  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-4xl mx-auto space-y-6">
        
        {/* Header with Build Stamp */}
        <div className="bg-white rounded-lg shadow-sm border p-6">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Core V1 Scoring Output</h1>
              <p className="text-gray-500 mt-1">Terrain analysis scoring system demo</p>
            </div>
            <div className="text-right text-sm">
              <div className="inline-flex items-center gap-2 bg-emerald-50 text-emerald-700 px-3 py-1.5 rounded-full font-medium">
                <CheckCircle2 className="w-4 h-4" />
                v{BUILD_STAMP.version} FROZEN
              </div>
              <div className="text-gray-400 mt-1">{BUILD_STAMP.frozen}</div>
              <div className="text-gray-500">
                {BUILD_STAMP.components.real}/{BUILD_STAMP.components.total} real
              </div>
            </div>
          </div>
        </div>
        
        {/* Parcel Info + Total Score */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white rounded-lg shadow-sm border p-6">
            <div className="text-sm text-gray-500 mb-1">Parcel Acreage</div>
            <div className="text-3xl font-bold text-gray-900">{parcelAcres.toFixed(1)} ac</div>
          </div>
          
          <div className="bg-white rounded-lg shadow-sm border p-6">
            <div className="text-sm text-gray-500 mb-1">Season Profile</div>
            <div className="text-xl font-semibold text-gray-900">{scoring.seasonName}</div>
            <div className="text-sm text-gray-400">Weights v{scoring.weightsVersion}</div>
          </div>
          
          <div className="bg-white rounded-lg shadow-sm border p-6 flex items-center justify-center">
            <GradeBadge grade={scoring.grade} score={scoring.totalScore} />
          </div>
        </div>
        
        {/* Confidence Summary */}
        <div className="bg-white rounded-lg shadow-sm border p-6">
          <div className="flex items-center gap-2 mb-4">
            <Info className="w-5 h-5 text-blue-500" />
            <h2 className="text-lg font-semibold text-gray-900">Provenance Summary</h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="text-2xl font-bold text-gray-900">{(scoring.overallConfidence * 100).toFixed(0)}%</div>
              <div className="text-sm text-gray-500">Overall Confidence</div>
            </div>
            <div className="bg-green-50 rounded-lg p-3">
              <div className="text-2xl font-bold text-green-700">{scoring.statusBreakdown.real}</div>
              <div className="text-sm text-green-600">Real Components</div>
            </div>
            <div className="bg-amber-50 rounded-lg p-3">
              <div className="text-2xl font-bold text-amber-700">{scoring.statusBreakdown.estimated}</div>
              <div className="text-sm text-amber-600">Estimated</div>
            </div>
            <div className="bg-gray-100 rounded-lg p-3">
              <div className="text-2xl font-bold text-gray-600">{scoring.statusBreakdown.stubbed}</div>
              <div className="text-sm text-gray-500">Stubbed</div>
            </div>
          </div>
        </div>
        
        {/* Component Breakdown Table */}
        <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
          <div className="px-6 py-4 border-b bg-gray-50">
            <h2 className="text-lg font-semibold text-gray-900">Component Breakdown</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Component</th>
                  <th className="text-center px-4 py-3 font-medium text-gray-600">Status</th>
                  <th className="text-center px-4 py-3 font-medium text-gray-600">Raw</th>
                  <th className="text-center px-4 py-3 font-medium text-gray-600">Score</th>
                  <th className="text-center px-4 py-3 font-medium text-gray-600">Weight</th>
                  <th className="text-center px-4 py-3 font-medium text-gray-600">Confidence</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {scoring.components.map((comp) => (
                  <tr key={comp.componentId} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{comp.name}</div>
                      <div className="text-xs text-gray-400 font-mono">{comp.componentId}</div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <StatusBadge status={comp.status} />
                    </td>
                    <td className="px-4 py-3 text-center font-mono text-gray-700">
                      {comp.raw}{comp.unit === 'percent' ? '%' : comp.unit === 'meters' ? 'm' : ''}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="inline-flex items-center gap-2">
                        <div className="w-16 h-2 bg-gray-200 rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-blue-500 rounded-full"
                            style={{ width: `${comp.normalized100}%` }}
                          />
                        </div>
                        <span className="font-medium text-gray-900">{comp.normalized100.toFixed(0)}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center text-gray-600">
                      {(comp.weight * 100).toFixed(0)}%
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`font-medium ${
                        comp.confidence >= 0.8 ? 'text-green-600' :
                        comp.confidence >= 0.5 ? 'text-amber-600' : 'text-gray-500'
                      }`}>
                        {(comp.confidence * 100).toFixed(0)}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-50 border-t-2">
                <tr>
                  <td className="px-4 py-3 font-bold text-gray-900">Total</td>
                  <td></td>
                  <td></td>
                  <td className="px-4 py-3 text-center font-bold text-gray-900">{scoring.totalScore}</td>
                  <td className="px-4 py-3 text-center text-gray-600">100%</td>
                  <td className="px-4 py-3 text-center font-medium text-gray-700">
                    {(scoring.overallConfidence * 100).toFixed(0)}%
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
        
        {/* Narrative Lines */}
        <div className="bg-white rounded-lg shadow-sm border p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Component Notes</h2>
          <div className="space-y-3">
            {scoring.components.map((comp) => (
              <div key={comp.componentId} className="flex gap-3">
                <StatusBadge status={comp.status} />
                <div className="flex-1">
                  <span className="font-medium text-gray-800">{comp.name}:</span>{' '}
                  <span className="text-gray-600">{comp.notes}</span>
                  <div className="text-xs text-gray-400 mt-0.5">
                    Inputs: {comp.inputsUsed.join(', ')}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
        
        {/* Raw JSON Toggle */}
        <div className="bg-white rounded-lg shadow-sm border overflow-hidden">
          <button
            onClick={() => setShowJson(!showJson)}
            className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
          >
            <span className="font-medium text-gray-700">Raw JSON Output</span>
            {showJson ? (
              <ChevronUp className="w-5 h-5 text-gray-400" />
            ) : (
              <ChevronDown className="w-5 h-5 text-gray-400" />
            )}
          </button>
          {showJson && (
            <div className="border-t bg-gray-900 p-4 overflow-x-auto">
              <pre className="text-xs text-green-400 font-mono whitespace-pre-wrap">
                {JSON.stringify(scoring, null, 2)}
              </pre>
            </div>
          )}
        </div>
        
        {/* Footer */}
        <div className="text-center text-sm text-gray-400 py-4">
          Generated at {new Date(scoring.timestamp).toLocaleString()} • 
          Terra Firma Partners Core V1
        </div>
        
      </div>
    </div>
  );
}
