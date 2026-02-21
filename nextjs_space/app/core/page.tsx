'use client';

import { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { ChevronDown, ChevronUp, CheckCircle2, AlertCircle, Clock, Info, RefreshCw, Loader2, Server } from 'lucide-react';
import type { TerrainAnalysisResponse, SeasonProfile, WindDirection } from '@/types/terrain';

// Build stamp for deployment verification
const BUILD_STAMP = {
  version: '1.0.0',
  frozen: '2026-02-21',
  components: { real: 6, stubbed: 1, total: 7 }
};

// Default demo parcel (Pleasant Hill, MO area - ~127 acres)
const DEFAULT_DEMO = {
  lat: 38.7876,
  lng: -94.2654,
  acreage: 127.4,
  address: 'Pleasant Hill, MO'
};

// Generate parcel polygon from center point and acreage
function generateParcelGeometry(lat: number, lng: number, acreage: number): GeoJSON.Feature<GeoJSON.Polygon> {
  const sqMeters = acreage * 4046.86;
  const side = Math.sqrt(sqMeters);
  const halfSide = side / 2;
  
  const metersPerDegLat = 111000;
  const metersPerDegLng = 111000 * Math.cos(lat * Math.PI / 180);
  
  const latOffset = halfSide / metersPerDegLat;
  const lngOffset = halfSide / metersPerDegLng;
  
  return {
    type: 'Feature',
    properties: { acreage, address: `${lat.toFixed(4)}, ${lng.toFixed(4)}` },
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [lng - lngOffset, lat - latOffset],
        [lng + lngOffset, lat - latOffset],
        [lng + lngOffset, lat + latOffset],
        [lng - lngOffset, lat + latOffset],
        [lng - lngOffset, lat - latOffset]
      ]]
    }
  };
}

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
  };
  timestamp: string;
  source: 'real' | 'mock';
  processingTimeMs: number;
  rawTerrainResponse?: TerrainAnalysisResponse;
}

const SEASON_WEIGHTS: Record<SeasonProfile, Record<string, number>> = {
  early: {
    bedding_quality: 0.15,
    funnel_density: 0.10,
    corridor_coverage: 0.15,
    water_proximity: 0.25,
    edge_habitat: 0.20,
    terrain_diversity: 0.05,
    stand_site_count: 0.10
  },
  rut: {
    bedding_quality: 0.25,
    funnel_density: 0.25,
    corridor_coverage: 0.20,
    water_proximity: 0.05,
    edge_habitat: 0.10,
    terrain_diversity: 0.10,
    stand_site_count: 0.05
  },
  late: {
    bedding_quality: 0.30,
    funnel_density: 0.10,
    corridor_coverage: 0.15,
    water_proximity: 0.10,
    edge_habitat: 0.15,
    terrain_diversity: 0.05,
    stand_site_count: 0.15
  }
};

const SEASON_NAMES: Record<string, string> = {
  early: 'Early Season',
  rut: 'Rut Season',
  late: 'Late Season',
  annual: 'Annual Average'
};

// Convert terrain response to scoring result
function convertTerrainToScoring(
  terrain: TerrainAnalysisResponse,
  season: SeasonProfile,
  parcelAcres: number,
  processingTimeMs: number
): ScoringResult {
  const weights = SEASON_WEIGHTS[season] || SEASON_WEIGHTS.rut;
  const { layers, summary, provenance } = terrain;
  
  // Calculate real scores from terrain data
  const standCount = layers.standPoints.features.length;
  const viableStands = layers.standPoints.features.filter(s => s.properties.score >= 60).length;
  const funnelCount = summary.funnelCount;
  const beddingAcres = summary.totalBeddingAcres;
  const demMetrics = summary.demMetrics;
  
  // Funnel density: weighted features per 100 acres, benchmark 8/100ac
  const saddles = layers.funnels.features.filter(f => f.properties.funnelType === 'saddle').length;
  const draws = layers.funnels.features.filter(f => f.properties.funnelType === 'draw').length;
  const corridors = layers.funnels.features.filter(f => f.properties.funnelType === 'corridor' && f.properties.corridorScore >= 0.3).length;
  const weightedFunnels = saddles * 1.5 + draws * 1.0 + corridors * 0.8;
  const funnelDensity = (weightedFunnels / parcelAcres) * 100;
  const funnelScore = Math.min(100, (funnelDensity / 8) * 100);
  
  // Bedding quality: based on acres and diversity
  const beddingDensity = beddingAcres / parcelAcres;
  const beddingScore = Math.min(100, beddingDensity * 400); // 25% coverage = 100
  
  // Stand site count: viable / 20
  const standScore = Math.min(100, (viableStands / 20) * 100);
  
  // Terrain diversity from DEM metrics
  let terrainDiversityScore = 60; // default
  if (demMetrics) {
    const elevScore = Math.min(1, demMetrics.elevRange / 60);
    const slopeScore = Math.min(1, demMetrics.slopeStd / 8);
    const tpiScore = Math.min(1, demMetrics.tpiContrast / 1.2);
    const roughScore = Math.min(1, demMetrics.roughness / 18);
    terrainDiversityScore = 100 * (0.30 * elevScore + 0.25 * slopeScore + 0.25 * tpiScore + 0.20 * roughScore);
  }
  
  // Water proximity (estimate from draws if no hydro)
  const waterScore = draws > 0 ? Math.min(100, 50 + draws * 10) : 50;
  
  // Corridor coverage (estimate from corridor count)
  const corridorScore = corridors > 0 ? Math.min(100, corridors * 25) : 40;
  
  // Edge habitat (stubbed)
  const edgeScore = parcelAcres >= 80 ? 65 : 55;
  
  const components: ComponentScore[] = [
    {
      componentId: 'bedding_quality',
      name: 'Bedding Area Quality',
      raw: Math.round(beddingAcres * 10) / 10,
      normalized: beddingScore / 100,
      normalized100: Math.round(beddingScore),
      weight: weights.bedding_quality,
      weighted: (beddingScore / 100) * weights.bedding_quality,
      unit: 'acres',
      notes: `${beddingAcres.toFixed(1)} acres of bedding identified across ${layers.beddingPolygons.features.length} zones.`,
      status: 'real',
      confidence: 0.95,
      inputsUsed: ['dem_slope', 'dem_aspect', 'parcel_boundary']
    },
    {
      componentId: 'funnel_density',
      name: 'Terrain Funnel Density',
      raw: Math.round(funnelDensity * 10) / 10,
      normalized: funnelScore / 100,
      normalized100: Math.round(funnelScore),
      weight: weights.funnel_density,
      weighted: (funnelScore / 100) * weights.funnel_density,
      unit: 'per_100ac',
      notes: `${saddles} saddles, ${draws} draws, ${corridors} corridors. ${funnelDensity.toFixed(1)} weighted/100ac.`,
      status: 'real',
      confidence: 0.90,
      inputsUsed: ['dem_tpi', 'dem_curvature', 'parcel_boundary']
    },
    {
      componentId: 'corridor_coverage',
      name: 'Travel Corridor Coverage',
      raw: corridors,
      normalized: corridorScore / 100,
      normalized100: Math.round(corridorScore),
      weight: weights.corridor_coverage,
      weighted: (corridorScore / 100) * weights.corridor_coverage,
      unit: 'count',
      notes: `${corridors} travel corridors identified with score ≥0.3.`,
      status: corridors > 0 ? 'real' : 'estimated',
      confidence: corridors > 0 ? 0.90 : 0.55,
      inputsUsed: ['dem_flow_accumulation', 'corridor_features']
    },
    {
      componentId: 'water_proximity',
      name: 'Water Source Proximity',
      raw: draws,
      normalized: waterScore / 100,
      normalized100: Math.round(waterScore),
      weight: weights.water_proximity,
      weighted: (waterScore / 100) * weights.water_proximity,
      unit: 'draws',
      notes: `${draws} terrain draws (potential water). Estimated from terrain features.`,
      status: 'estimated',
      confidence: 0.65,
      inputsUsed: ['terrain_draws', 'dem_flow']
    },
    {
      componentId: 'terrain_diversity',
      name: 'Terrain Diversity Index',
      raw: Math.round(terrainDiversityScore),
      normalized: terrainDiversityScore / 100,
      normalized100: Math.round(terrainDiversityScore),
      weight: weights.terrain_diversity,
      weighted: (terrainDiversityScore / 100) * weights.terrain_diversity,
      unit: 'score',
      notes: demMetrics 
        ? `Real DEM: Elev ${demMetrics.elevRange.toFixed(0)}m, Slope σ ${demMetrics.slopeStd.toFixed(1)}°, TPI ${demMetrics.tpiContrast.toFixed(2)}`
        : 'Estimated from terrain features.',
      status: demMetrics ? 'real' : 'estimated',
      confidence: demMetrics ? 0.95 : 0.55,
      inputsUsed: demMetrics ? ['dem_elevation', 'dem_slope', 'dem_tpi_500'] : ['terrain_funnels']
    },
    {
      componentId: 'stand_site_count',
      name: 'Viable Stand Sites',
      raw: viableStands,
      normalized: standScore / 100,
      normalized100: Math.round(standScore),
      weight: weights.stand_site_count,
      weighted: (standScore / 100) * weights.stand_site_count,
      unit: 'count',
      notes: `${viableStands} viable stands (score ≥60) of ${standCount} total.`,
      status: 'real',
      confidence: 0.90,
      inputsUsed: ['dem_terrain_analysis', 'stand_points', 'tpi_analysis']
    },
    {
      componentId: 'edge_habitat',
      name: 'Edge Habitat Quality',
      raw: edgeScore,
      normalized: edgeScore / 100,
      normalized100: edgeScore,
      weight: weights.edge_habitat,
      weighted: (edgeScore / 100) * weights.edge_habitat,
      unit: 'score',
      notes: `[STUB] Estimated from parcel size (${parcelAcres.toFixed(0)} ac). Requires NLCD.`,
      status: 'stubbed',
      confidence: 0.30,
      inputsUsed: ['parcel_acreage']
    }
  ];
  
  const totalWeighted = components.reduce((sum, c) => sum + c.weighted, 0);
  const totalScore = Math.round(totalWeighted * 100);
  
  let grade: string;
  if (totalScore >= 85) grade = 'A';
  else if (totalScore >= 70) grade = 'B';
  else if (totalScore >= 55) grade = 'C';
  else if (totalScore >= 40) grade = 'D';
  else grade = 'F';
  
  const weightedConfidence = components.reduce((sum, c) => sum + c.confidence * c.weight, 0);
  
  const realCount = components.filter(c => c.status === 'real').length;
  const estimatedCount = components.filter(c => c.status === 'estimated').length;
  const stubbedCount = components.filter(c => c.status === 'stubbed').length;
  
  return {
    weightsVersion: '1.0',
    season,
    seasonName: SEASON_NAMES[season],
    totalScore,
    grade,
    components,
    overallConfidence: Math.round(weightedConfidence * 100) / 100,
    statusBreakdown: { real: realCount, estimated: estimatedCount, stubbed: stubbedCount },
    timestamp: provenance.analysisTimestamp,
    source: 'real',
    processingTimeMs,
    rawTerrainResponse: terrain
  };
}

// Generate mock fallback
function generateMockScoring(acreage: number, season: SeasonProfile): ScoringResult {
  const weights = SEASON_WEIGHTS[season] || SEASON_WEIGHTS.rut;
  
  const components: ComponentScore[] = [
    {
      componentId: 'bedding_quality', name: 'Bedding Area Quality',
      raw: 18.5, normalized: 0.72, normalized100: 72, weight: weights.bedding_quality,
      weighted: 0.72 * weights.bedding_quality, unit: 'acres',
      notes: '[MOCK] 18.5 acres estimated bedding.',
      status: 'estimated', confidence: 0.50, inputsUsed: ['mock_data']
    },
    {
      componentId: 'funnel_density', name: 'Terrain Funnel Density',
      raw: 5.2, normalized: 0.65, normalized100: 65, weight: weights.funnel_density,
      weighted: 0.65 * weights.funnel_density, unit: 'per_100ac',
      notes: '[MOCK] Estimated 5.2 weighted funnels/100ac.',
      status: 'estimated', confidence: 0.50, inputsUsed: ['mock_data']
    },
    {
      componentId: 'corridor_coverage', name: 'Travel Corridor Coverage',
      raw: 2, normalized: 0.50, normalized100: 50, weight: weights.corridor_coverage,
      weighted: 0.50 * weights.corridor_coverage, unit: 'count',
      notes: '[MOCK] 2 corridors estimated.',
      status: 'estimated', confidence: 0.50, inputsUsed: ['mock_data']
    },
    {
      componentId: 'water_proximity', name: 'Water Source Proximity',
      raw: 3, normalized: 0.70, normalized100: 70, weight: weights.water_proximity,
      weighted: 0.70 * weights.water_proximity, unit: 'draws',
      notes: '[MOCK] 3 draws estimated.',
      status: 'estimated', confidence: 0.50, inputsUsed: ['mock_data']
    },
    {
      componentId: 'terrain_diversity', name: 'Terrain Diversity Index',
      raw: 62, normalized: 0.62, normalized100: 62, weight: weights.terrain_diversity,
      weighted: 0.62 * weights.terrain_diversity, unit: 'score',
      notes: '[MOCK] Estimated diversity score.',
      status: 'estimated', confidence: 0.50, inputsUsed: ['mock_data']
    },
    {
      componentId: 'stand_site_count', name: 'Viable Stand Sites',
      raw: 6, normalized: 0.30, normalized100: 30, weight: weights.stand_site_count,
      weighted: 0.30 * weights.stand_site_count, unit: 'count',
      notes: '[MOCK] 6 stands estimated.',
      status: 'estimated', confidence: 0.50, inputsUsed: ['mock_data']
    },
    {
      componentId: 'edge_habitat', name: 'Edge Habitat Quality',
      raw: 60, normalized: 0.60, normalized100: 60, weight: weights.edge_habitat,
      weighted: 0.60 * weights.edge_habitat, unit: 'score',
      notes: `[STUB] Estimated from parcel size (${acreage.toFixed(0)} ac).`,
      status: 'stubbed', confidence: 0.30, inputsUsed: ['parcel_acreage']
    }
  ];
  
  const totalWeighted = components.reduce((sum, c) => sum + c.weighted, 0);
  const totalScore = Math.round(totalWeighted * 100);
  const grade = totalScore >= 85 ? 'A' : totalScore >= 70 ? 'B' : totalScore >= 55 ? 'C' : totalScore >= 40 ? 'D' : 'F';
  
  return {
    weightsVersion: '1.0',
    season,
    seasonName: SEASON_NAMES[season],
    totalScore,
    grade,
    components,
    overallConfidence: 0.50,
    statusBreakdown: { real: 0, estimated: 6, stubbed: 1 },
    timestamp: new Date().toISOString(),
    source: 'mock',
    processingTimeMs: 0
  };
}

// localStorage cache key
const CACHE_KEY = 'tfp_core_scoring_cache';

function getCachedScoring(): ScoringResult | null {
  if (typeof window === 'undefined') return null;
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached) as ScoringResult;
      // Cache valid for 1 hour
      const cacheAge = Date.now() - new Date(parsed.timestamp).getTime();
      if (cacheAge < 60 * 60 * 1000) return parsed;
    }
  } catch { /* ignore */ }
  return null;
}

function setCachedScoring(result: ScoringResult): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(result));
  } catch { /* ignore */ }
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
    A: 'bg-green-600', B: 'bg-blue-600', C: 'bg-amber-500', D: 'bg-orange-500', F: 'bg-red-600'
  };
  
  return (
    <div className={`${colors[grade]} text-white rounded-lg px-6 py-4 text-center`}>
      <div className="text-4xl font-bold">{grade}</div>
      <div className="text-lg opacity-90">{score}/100</div>
    </div>
  );
}

// Source badge
function SourceBadge({ source, processingMs }: { source: 'real' | 'mock'; processingMs: number }) {
  if (source === 'real') {
    return (
      <div className="inline-flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-full font-bold text-sm">
        <Server className="w-4 h-4" />
        REAL ANALYSIS
        <span className="text-green-200 text-xs">({(processingMs / 1000).toFixed(1)}s)</span>
      </div>
    );
  }
  return (
    <div className="inline-flex items-center gap-2 bg-amber-500 text-white px-4 py-2 rounded-full font-bold text-sm">
      <AlertCircle className="w-4 h-4" />
      MOCK FALLBACK
    </div>
  );
}

function CoreScoringContent() {
  const searchParams = useSearchParams();
  const [showJson, setShowJson] = useState(false);
  const [scoring, setScoring] = useState<ScoringResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const hasRun = useRef(false);
  
  // Parse query params with defaults
  const lat = parseFloat(searchParams.get('lat') || '') || DEFAULT_DEMO.lat;
  const lng = parseFloat(searchParams.get('lng') || '') || DEFAULT_DEMO.lng;
  const season = (searchParams.get('season') as SeasonProfile) || 'rut';
  const wind = (searchParams.get('wind') as WindDirection) || 'NW';
  const acreage = parseFloat(searchParams.get('acres') || '') || DEFAULT_DEMO.acreage;
  
  const runAnalysis = useCallback(async (force = false) => {
    // Check cache first (unless forced)
    if (!force) {
      const cached = getCachedScoring();
      if (cached) {
        setScoring(cached);
        return;
      }
    }
    
    setIsLoading(true);
    setError(null);
    setProgress(10);
    
    const startTime = Date.now();
    const parcel = generateParcelGeometry(lat, lng, acreage);
    
    try {
      setProgress(30);
      
      const response = await fetch('/api/terrain-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parcel,
          seasonProfile: season,
          prevailingWinds: [wind],
          bufferMeters: 800
        })
      });
      
      setProgress(70);
      
      if (!response.ok) {
        throw new Error(`Analysis failed: ${response.status}`);
      }
      
      const terrain = await response.json() as TerrainAnalysisResponse;
      const processingMs = Date.now() - startTime;
      
      setProgress(90);
      
      const result = convertTerrainToScoring(terrain, season, acreage, processingMs);
      setCachedScoring(result);
      setScoring(result);
      setProgress(100);
      
    } catch (err) {
      console.error('[Core] Analysis error:', err);
      setError(err instanceof Error ? err.message : 'Analysis failed');
      
      // Fall back to mock
      const mock = generateMockScoring(acreage, season);
      setScoring(mock);
    } finally {
      setIsLoading(false);
    }
  }, [lat, lng, acreage, season, wind]);
  
  // Auto-run on mount
  useEffect(() => {
    if (!hasRun.current) {
      hasRun.current = true;
      runAnalysis();
    }
  }, [runAnalysis]);
  
  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-4xl mx-auto space-y-6">
        
        {/* Header with Build Stamp + Source Badge */}
        <div className="bg-white rounded-lg shadow-sm border p-6">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Core V1 Scoring Output</h1>
              <p className="text-gray-500 mt-1">Terrain analysis scoring system</p>
            </div>
            <div className="flex flex-col items-end gap-2">
              {scoring && <SourceBadge source={scoring.source} processingMs={scoring.processingTimeMs} />}
              <div className="text-sm text-gray-400">
                v{BUILD_STAMP.version} FROZEN • {BUILD_STAMP.components.real}/{BUILD_STAMP.components.total} real
              </div>
            </div>
          </div>
          
          {/* Run Again Button */}
          <div className="mt-4 pt-4 border-t flex items-center gap-4">
            <button
              onClick={() => runAnalysis(true)}
              disabled={isLoading}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isLoading ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Analyzing...</>
              ) : (
                <><RefreshCw className="w-4 h-4" /> Run Analysis</>
              )}
            </button>
            
            {isLoading && (
              <div className="flex-1">
                <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-blue-500 transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <div className="text-xs text-gray-500 mt-1">Processing terrain data...</div>
              </div>
            )}
            
            {error && (
              <div className="text-sm text-amber-600 flex items-center gap-1">
                <AlertCircle className="w-4 h-4" />
                {error} (using mock fallback)
              </div>
            )}
          </div>
        </div>
        
        {/* Loading State */}
        {isLoading && !scoring && (
          <div className="bg-white rounded-lg shadow-sm border p-12 text-center">
            <Loader2 className="w-12 h-12 animate-spin text-blue-500 mx-auto mb-4" />
            <div className="text-lg font-medium text-gray-700">Running terrain analysis...</div>
            <div className="text-sm text-gray-500 mt-2">
              Analyzing {acreage.toFixed(0)} acres at {lat.toFixed(4)}, {lng.toFixed(4)}
            </div>
          </div>
        )}
        
        {scoring && (
          <>
            {/* Parcel Info + Total Score */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-white rounded-lg shadow-sm border p-6">
                <div className="text-sm text-gray-500 mb-1">Location</div>
                <div className="text-lg font-semibold text-gray-900">{lat.toFixed(4)}, {lng.toFixed(4)}</div>
                <div className="text-2xl font-bold text-gray-900 mt-1">{acreage.toFixed(1)} ac</div>
              </div>
              
              <div className="bg-white rounded-lg shadow-sm border p-6">
                <div className="text-sm text-gray-500 mb-1">Season Profile</div>
                <div className="text-xl font-semibold text-gray-900">{scoring.seasonName}</div>
                <div className="text-sm text-gray-400">Wind: {wind} • Weights v{scoring.weightsVersion}</div>
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
                          {comp.raw}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="inline-flex items-center gap-2">
                            <div className="w-16 h-2 bg-gray-200 rounded-full overflow-hidden">
                              <div 
                                className="h-full bg-blue-500 rounded-full"
                                style={{ width: `${comp.normalized100}%` }}
                              />
                            </div>
                            <span className="font-medium text-gray-900">{comp.normalized100}</span>
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
              Terra Firma Partners Core V1 • 
              <span className="font-mono">?lat={lat}&amp;lng={lng}&amp;season={season}&amp;wind={wind}</span>
            </div>
          </>
        )}
        
      </div>
    </div>
  );
}

// Wrap with Suspense for useSearchParams
export default function CoreScoringPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="w-12 h-12 animate-spin text-blue-500 mx-auto mb-4" />
          <div className="text-gray-600">Loading Core V1 Scoring...</div>
        </div>
      </div>
    }>
      <CoreScoringContent />
    </Suspense>
  );
}
