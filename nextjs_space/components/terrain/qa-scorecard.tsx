'use client';

import React, { useState, useCallback, useMemo } from 'react';
import {
  ThumbsUp, HelpCircle, Wrench, Copy, Check, X, ChevronDown, ChevronUp,
  FileText, Trash2, Download, BarChart3, MapPin, Cpu, Scale, Tag, AlertTriangle,
  Briefcase, Star, TrendingUp
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { type BrokerClass, type BrokerScoreComponents, getBrokerClassLabel, getBrokerClassShort, getBrokerClassColor } from '@/lib/broker-scoring';

export type QARating = 'believable' | 'mixed' | 'needs_tuning';

export interface QAEntry {
  id: string;
  timestamp: string;
  state: string;
  county: string;
  acreage: number;
  parcelId: string;
  demMode: string;
  rating: QARating;
  note?: string;
  // Broker scoring fields
  brokerScore?: number;
  brokerClass?: BrokerClass;
  brokerComponents?: BrokerScoreComponents;
}

interface QAScorecardProps {
  parcelId: string;
  state: string;
  county: string;
  acreage: number;
  demMode: string;
  brokerScore?: number;
  brokerClass?: BrokerClass;
  brokerComponents?: BrokerScoreComponents;
  onRatingSubmit: (entry: QAEntry) => void;
  onSkip: () => void;
}

export function QAScorecard({
  parcelId,
  state,
  county,
  acreage,
  demMode,
  brokerScore,
  brokerClass,
  brokerComponents,
  onRatingSubmit,
  onSkip
}: QAScorecardProps) {
  const [selectedRating, setSelectedRating] = useState<QARating | null>(null);
  const [note, setNote] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [showBrokerDetails, setShowBrokerDetails] = useState(false);

  const handleSubmit = useCallback(() => {
    if (!selectedRating) return;
    
    const entry: QAEntry = {
      id: `${parcelId}-${Date.now()}`,
      timestamp: new Date().toISOString(),
      state,
      county,
      acreage,
      parcelId,
      demMode,
      rating: selectedRating,
      note: note.trim() || undefined,
      brokerScore,
      brokerClass,
      brokerComponents
    };
    
    onRatingSubmit(entry);
    setSubmitted(true);
  }, [selectedRating, note, parcelId, state, county, acreage, demMode, brokerScore, brokerClass, brokerComponents, onRatingSubmit]);

  if (submitted) {
    return (
      <div className="bg-gray-900/95 backdrop-blur-sm border border-emerald-500/30 rounded-xl p-4">
        <div className="flex items-center gap-2 text-emerald-400">
          <Check className="h-5 w-5" />
          <span className="font-medium">Rating saved!</span>
        </div>
        <p className="text-xs text-gray-400 mt-1">Clear parcel to test another</p>
      </div>
    );
  }

  const ratingButtons: Array<{ value: QARating; label: string; icon: typeof ThumbsUp; color: 'emerald' | 'amber' | 'red' }> = [
    { value: 'believable', label: 'Believable', icon: ThumbsUp, color: 'emerald' },
    { value: 'mixed', label: 'Mixed', icon: HelpCircle, color: 'amber' },
    { value: 'needs_tuning', label: 'Needs Tuning', icon: Wrench, color: 'red' },
  ];

  const brokerColors = brokerClass ? getBrokerClassColor(brokerClass) : null;

  return (
    <div className="bg-gray-900/95 backdrop-blur-sm border border-cyan-500/30 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-4 py-2.5 bg-gradient-to-r from-cyan-900/40 to-gray-900/40 border-b border-cyan-500/20">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-white">Rate This Parcel</span>
          <button
            onClick={onSkip}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            Skip
          </button>
        </div>
      </div>
      
      {/* Broker Score Badge */}
      {brokerScore !== undefined && brokerClass && brokerColors && (
        <div className="px-3 py-2 border-b border-gray-800">
          <button 
            onClick={() => setShowBrokerDetails(!showBrokerDetails)}
            className="w-full"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Briefcase className={`h-3.5 w-3.5 ${brokerColors.text}`} />
                <span className="text-xs text-gray-400">Broker Ready:</span>
                <span className={`text-xs font-bold ${brokerColors.text}`}>
                  {getBrokerClassShort(brokerClass)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-sm font-bold ${brokerColors.text}`}>
                  {(brokerScore * 100).toFixed(0)}
                </span>
                <ChevronDown className={`h-3 w-3 text-gray-500 transition-transform ${showBrokerDetails ? 'rotate-180' : ''}`} />
              </div>
            </div>
            
            {/* Score bar */}
            <div className="mt-1.5 h-1.5 bg-gray-800 rounded-full overflow-hidden">
              <div 
                className={`h-full transition-all ${
                  brokerClass === 'broker_ready' ? 'bg-emerald-500' :
                  brokerClass === 'potential_demo' ? 'bg-amber-500' : 'bg-slate-500'
                }`}
                style={{ width: `${brokerScore * 100}%` }}
              />
            </div>
          </button>
          
          {/* Expanded component details */}
          {showBrokerDetails && brokerComponents && (
            <div className="mt-2 pt-2 border-t border-gray-800 space-y-1.5">
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px]">
                <div className="flex justify-between">
                  <span className="text-gray-500">Flow Quality</span>
                  <span className={brokerComponents.flowStructureQuality >= 0.7 ? 'text-emerald-400' : brokerComponents.flowStructureQuality >= 0.4 ? 'text-amber-400' : 'text-gray-400'}>
                    {(brokerComponents.flowStructureQuality * 100).toFixed(0)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Convergence</span>
                  <span className={brokerComponents.convergenceStrength >= 0.7 ? 'text-emerald-400' : brokerComponents.convergenceStrength >= 0.4 ? 'text-amber-400' : 'text-gray-400'}>
                    {(brokerComponents.convergenceStrength * 100).toFixed(0)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Terrain Features</span>
                  <span className={brokerComponents.terrainFeatureSupport >= 0.7 ? 'text-emerald-400' : brokerComponents.terrainFeatureSupport >= 0.4 ? 'text-amber-400' : 'text-gray-400'}>
                    {(brokerComponents.terrainFeatureSupport * 100).toFixed(0)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">DEM Confidence</span>
                  <span className={brokerComponents.demConfidence >= 0.7 ? 'text-emerald-400' : brokerComponents.demConfidence >= 0.4 ? 'text-amber-400' : 'text-gray-400'}>
                    {(brokerComponents.demConfidence * 100).toFixed(0)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Acreage Fit</span>
                  <span className={brokerComponents.acreageAppropriateness >= 0.7 ? 'text-emerald-400' : brokerComponents.acreageAppropriateness >= 0.4 ? 'text-amber-400' : 'text-gray-400'}>
                    {(brokerComponents.acreageAppropriateness * 100).toFixed(0)}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
      
      <div className="p-3 space-y-3">
        {/* Rating Buttons */}
        <div className="flex gap-2">
          {ratingButtons.map(({ value, label, icon: Icon, color }) => {
            const isSelected = selectedRating === value;
            const baseClasses = 'flex-1 flex flex-col items-center gap-1 py-2 px-2 rounded-lg border transition-all text-xs font-medium';
            const colorClasses = {
              emerald: isSelected 
                ? 'bg-emerald-600/30 border-emerald-500 text-emerald-300' 
                : 'bg-gray-800/50 border-gray-700 text-gray-400 hover:border-emerald-500/50 hover:text-emerald-400',
              amber: isSelected 
                ? 'bg-amber-600/30 border-amber-500 text-amber-300' 
                : 'bg-gray-800/50 border-gray-700 text-gray-400 hover:border-amber-500/50 hover:text-amber-400',
              red: isSelected 
                ? 'bg-red-600/30 border-red-500 text-red-300' 
                : 'bg-gray-800/50 border-gray-700 text-gray-400 hover:border-red-500/50 hover:text-red-400',
            };
            
            return (
              <button
                key={value}
                onClick={() => setSelectedRating(value)}
                className={`${baseClasses} ${colorClasses[color]}`}
              >
                <Icon className="h-4 w-4" />
                <span>{label}</span>
              </button>
            );
          })}
        </div>
        
        {/* Note Field */}
        <div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional note (e.g., 'flows ignore ridge')..."
            className="w-full px-3 py-2 bg-gray-800/50 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:border-cyan-500 focus:outline-none resize-none"
            rows={2}
          />
        </div>
        
        {/* Submit */}
        <Button
          onClick={handleSubmit}
          disabled={!selectedRating}
          size="sm"
          className="w-full bg-cyan-600 hover:bg-cyan-500 disabled:bg-gray-700 disabled:text-gray-500"
        >
          Save Rating
        </Button>
      </div>
    </div>
  );
}

// Session Summary Panel
interface QASessionSummaryProps {
  entries: QAEntry[];
  onClear: () => void;
  onExport: () => void;
  onShowAnalytics?: () => void;
}

export function QASessionSummary({ entries, onClear, onExport, onShowAnalytics }: QASessionSummaryProps) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  
  const believable = entries.filter(e => e.rating === 'believable').length;
  const mixed = entries.filter(e => e.rating === 'mixed').length;
  const needsTuning = entries.filter(e => e.rating === 'needs_tuning').length;
  const total = entries.length;
  
  // Broker counts
  const brokerReady = entries.filter(e => e.brokerClass === 'broker_ready').length;
  const potentialDemo = entries.filter(e => e.brokerClass === 'potential_demo').length;
  const notBrokerReady = entries.filter(e => e.brokerClass === 'not_broker_ready').length;
  const hasBrokerScores = brokerReady + potentialDemo + notBrokerReady > 0;
  
  const handleCopy = useCallback(() => {
    const log = formatSessionLog(entries);
    navigator.clipboard.writeText(log);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [entries]);
  
  if (total === 0) return null;
  
  return (
    <div className="bg-gray-900/95 backdrop-blur-sm border border-purple-500/30 rounded-xl overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-2.5 bg-gradient-to-r from-purple-900/40 to-gray-900/40 border-b border-purple-500/20 flex items-center justify-between"
      >
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-purple-400" />
          <span className="text-sm font-medium text-white">QA Session</span>
          <span className="text-xs text-purple-400 bg-purple-500/20 px-2 py-0.5 rounded-full">
            {total} tested
          </span>
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-gray-400" />
        ) : (
          <ChevronDown className="h-4 w-4 text-gray-400" />
        )}
      </button>
      
      {/* Summary Stats */}
      <div className="px-4 py-3 border-b border-gray-800">
        <div className="flex justify-between text-xs">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-emerald-500" />
            <span className="text-gray-400">Believable:</span>
            <span className="text-emerald-400 font-medium">{believable}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-amber-500" />
            <span className="text-gray-400">Mixed:</span>
            <span className="text-amber-400 font-medium">{mixed}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-red-500" />
            <span className="text-gray-400">Tuning:</span>
            <span className="text-red-400 font-medium">{needsTuning}</span>
          </div>
        </div>
        
        {/* Percentage bar */}
        {total > 0 && (
          <div className="mt-2 h-1.5 bg-gray-800 rounded-full overflow-hidden flex">
            {believable > 0 && (
              <div 
                className="bg-emerald-500 h-full" 
                style={{ width: `${(believable / total) * 100}%` }} 
              />
            )}
            {mixed > 0 && (
              <div 
                className="bg-amber-500 h-full" 
                style={{ width: `${(mixed / total) * 100}%` }} 
              />
            )}
            {needsTuning > 0 && (
              <div 
                className="bg-red-500 h-full" 
                style={{ width: `${(needsTuning / total) * 100}%` }} 
              />
            )}
          </div>
        )}
        
        {/* Broker Stats */}
        {hasBrokerScores && (
          <div className="mt-3 pt-2 border-t border-gray-800/50">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Briefcase className="h-3 w-3 text-indigo-400" />
              <span className="text-[10px] text-indigo-400 font-medium">BROKER READY</span>
            </div>
            <div className="flex justify-between text-xs">
              <div className="flex items-center gap-1">
                <Star className="h-2.5 w-2.5 text-emerald-400" />
                <span className="text-emerald-400 font-medium">{brokerReady}</span>
              </div>
              <div className="flex items-center gap-1">
                <TrendingUp className="h-2.5 w-2.5 text-amber-400" />
                <span className="text-amber-400 font-medium">{potentialDemo}</span>
              </div>
              <div className="flex items-center gap-1">
                <X className="h-2.5 w-2.5 text-slate-400" />
                <span className="text-slate-400 font-medium">{notBrokerReady}</span>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-gray-500 text-[10px]">Rate:</span>
                <span className={`font-medium ${
                  (brokerReady / total) >= 0.5 ? 'text-emerald-400' :
                  (brokerReady / total) >= 0.3 ? 'text-amber-400' : 'text-slate-400'
                }`}>
                  {Math.round((brokerReady / total) * 100)}%
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
      
      {/* Expanded Entry List */}
      {expanded && (
        <div className="max-h-48 overflow-y-auto">
          {entries.slice().reverse().map((entry, idx) => {
            const entryBrokerColors = entry.brokerClass ? getBrokerClassColor(entry.brokerClass) : null;
            return (
              <div 
                key={entry.id} 
                className="px-4 py-2 border-b border-gray-800/50 last:border-b-0 text-xs"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-gray-500">#{total - idx}</span>
                    <span className="text-white font-medium">
                      {entry.county}, {entry.state}
                    </span>
                    <span className="text-gray-500">{entry.acreage.toFixed(0)} ac</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {/* Broker badge */}
                    {entry.brokerScore !== undefined && entryBrokerColors && (
                      <div className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${entryBrokerColors.bg} ${entryBrokerColors.text}`}>
                        {(entry.brokerScore * 100).toFixed(0)}
                      </div>
                    )}
                    {/* Rating badge */}
                    <div className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                      entry.rating === 'believable' ? 'bg-emerald-500/20 text-emerald-400' :
                      entry.rating === 'mixed' ? 'bg-amber-500/20 text-amber-400' :
                      'bg-red-500/20 text-red-400'
                    }`}>
                      {entry.rating === 'believable' ? '✓' : entry.rating === 'mixed' ? '~' : '!'}
                    </div>
                  </div>
                </div>
                {entry.note && (
                  <div className="text-gray-500 mt-1 italic">"{entry.note}"</div>
                )}
              </div>
            );
          })}
        </div>
      )}
      
      {/* Actions */}
      <div className="px-4 py-2 bg-gray-800/30 flex gap-2">
        {onShowAnalytics && total >= 5 && (
          <Button
            onClick={onShowAnalytics}
            size="sm"
            variant="outline"
            className="h-7 text-xs border-indigo-700 text-indigo-400 hover:bg-indigo-900/30"
          >
            <BarChart3 className="h-3 w-3" />
          </Button>
        )}
        <Button
          onClick={handleCopy}
          size="sm"
          variant="outline"
          className="flex-1 h-7 text-xs border-gray-700 hover:bg-gray-800"
        >
          {copied ? (
            <><Check className="h-3 w-3 mr-1" /> Copied!</>
          ) : (
            <><Copy className="h-3 w-3 mr-1" /> Copy Log</>
          )}
        </Button>
        <Button
          onClick={onExport}
          size="sm"
          variant="outline"
          className="flex-1 h-7 text-xs border-gray-700 hover:bg-gray-800"
        >
          <Download className="h-3 w-3 mr-1" /> CSV
        </Button>
        <Button
          onClick={onClear}
          size="sm"
          variant="outline"
          className="h-7 text-xs border-red-900 text-red-400 hover:bg-red-900/30"
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

// Helper to format session log as text
function formatSessionLog(entries: QAEntry[]): string {
  const header = `Terra Firma QA Session Log\nGenerated: ${new Date().toISOString()}\nTotal Tested: ${entries.length}\n\n`;
  
  const brokerReady = entries.filter(e => e.brokerClass === 'broker_ready').length;
  const potentialDemo = entries.filter(e => e.brokerClass === 'potential_demo').length;
  const notBrokerReady = entries.filter(e => e.brokerClass === 'not_broker_ready').length;
  const avgBrokerScore = entries.filter(e => e.brokerScore !== undefined).length > 0
    ? (entries.filter(e => e.brokerScore !== undefined).reduce((sum, e) => sum + (e.brokerScore || 0), 0) / entries.filter(e => e.brokerScore !== undefined).length).toFixed(2)
    : 'N/A';
  
  const summary = `SUMMARY\n-------\nBelievable: ${entries.filter(e => e.rating === 'believable').length}\nMixed: ${entries.filter(e => e.rating === 'mixed').length}\nNeeds Tuning: ${entries.filter(e => e.rating === 'needs_tuning').length}\n\nBROKER READY\n------------\nBroker Ready: ${brokerReady}\nPotential Demo: ${potentialDemo}\nNot Broker Ready: ${notBrokerReady}\nAvg Score: ${avgBrokerScore}\n\n`;
  
  const details = `DETAILS\n-------\n` + entries.map((e, idx) => {
    const rating = e.rating === 'believable' ? '✓ Believable' : 
                   e.rating === 'mixed' ? '~ Mixed' : '! Needs Tuning';
    const brokerInfo = e.brokerScore !== undefined ? ` | Broker: ${(e.brokerScore * 100).toFixed(0)}` : '';
    return `#${idx + 1} | ${e.county}, ${e.state} | ${e.acreage.toFixed(1)} ac | ${e.demMode} | ${rating}${brokerInfo}${e.note ? ` | "${e.note}"` : ''}`;
  }).join('\n');
  
  return header + summary + details;
}

// Helper to export as CSV
export function exportSessionCSV(entries: QAEntry[]): void {
  const header = 'timestamp,state,county,acreage,parcelId,demMode,rating,note,brokerScore,brokerClass,flowStructureQuality,convergenceStrength,terrainFeatureSupport,demConfidence,acreageAppropriateness';
  const rows = entries.map(e => {
    const comp = e.brokerComponents;
    return `${e.timestamp},${e.state},${e.county},${e.acreage.toFixed(1)},${e.parcelId},${e.demMode},${e.rating},"${(e.note || '').replace(/"/g, '""')}",${e.brokerScore ?? ''},${e.brokerClass ?? ''},${comp?.flowStructureQuality ?? ''},${comp?.convergenceStrength ?? ''},${comp?.terrainFeatureSupport ?? ''},${comp?.demConfidence ?? ''},${comp?.acreageAppropriateness ?? ''}`;
  });
  
  const csv = [header, ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = `tfp-qa-session-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  
  URL.revokeObjectURL(url);
}

// ============ ANALYTICS TYPES & HELPERS ============

interface StateBreakdown {
  state: string;
  total: number;
  believable: number;
  mixed: number;
  needsTuning: number;
  successRate: number;
}

interface DEMModeBreakdown {
  mode: string;
  total: number;
  believable: number;
  mixed: number;
  needsTuning: number;
  successRate: number;
}

interface AcreageStats {
  rating: QARating;
  avgAcreage: number;
  minAcreage: number;
  maxAcreage: number;
  count: number;
}

interface KeywordPattern {
  keyword: string;
  count: number;
  contexts: string[];
}

interface FailurePattern {
  pattern: string;
  count: number;
  examples: string[];
}

// Common terrain/flow-related keywords to look for
const TERRAIN_KEYWORDS = [
  'ridge', 'saddle', 'flow', 'corridor', 'bench', 'drainage', 'draw',
  'slope', 'flat', 'terrain', 'elevation', 'contour', 'valley', 'creek',
  'timber', 'edge', 'funnel', 'pinch', 'bottleneck', 'crossing',
  'ignore', 'miss', 'wrong', 'backwards', 'uphill', 'downhill',
  'weak', 'strong', 'good', 'bad', 'weird', 'odd', 'perfect'
];

function extractKeywords(notes: string[]): KeywordPattern[] {
  const keywordMap = new Map<string, { count: number; contexts: string[] }>();
  
  notes.forEach(note => {
    const lowerNote = note.toLowerCase();
    TERRAIN_KEYWORDS.forEach(kw => {
      if (lowerNote.includes(kw)) {
        const existing = keywordMap.get(kw) || { count: 0, contexts: [] };
        existing.count++;
        if (existing.contexts.length < 3) {
          existing.contexts.push(note.slice(0, 60));
        }
        keywordMap.set(kw, existing);
      }
    });
  });
  
  return Array.from(keywordMap.entries())
    .map(([keyword, data]) => ({ keyword, ...data }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
}

function analyzeFailurePatterns(entries: QAEntry[]): FailurePattern[] {
  const failures = entries.filter(e => e.rating === 'needs_tuning' || e.rating === 'mixed');
  const patterns: FailurePattern[] = [];
  
  // Pattern 1: DEM mode correlation
  const demModeCounts = new Map<string, number>();
  failures.forEach(e => {
    demModeCounts.set(e.demMode, (demModeCounts.get(e.demMode) || 0) + 1);
  });
  
  demModeCounts.forEach((count, mode) => {
    if (count >= 2) {
      patterns.push({
        pattern: `${mode} mode issues`,
        count,
        examples: failures.filter(e => e.demMode === mode).slice(0, 2).map(e => `${e.county}, ${e.state}`)
      });
    }
  });
  
  // Pattern 2: Acreage-based issues (very small or very large)
  const smallParcels = failures.filter(e => e.acreage < 100);
  const largeParcels = failures.filter(e => e.acreage > 160);
  
  if (smallParcels.length >= 2) {
    patterns.push({
      pattern: 'Small parcels (<100 ac)',
      count: smallParcels.length,
      examples: smallParcels.slice(0, 2).map(e => `${e.acreage.toFixed(0)} ac - ${e.county}`)
    });
  }
  
  if (largeParcels.length >= 2) {
    patterns.push({
      pattern: 'Large parcels (>160 ac)',
      count: largeParcels.length,
      examples: largeParcels.slice(0, 2).map(e => `${e.acreage.toFixed(0)} ac - ${e.county}`)
    });
  }
  
  // Pattern 3: State-specific issues
  const stateCounts = new Map<string, number>();
  failures.forEach(e => {
    stateCounts.set(e.state, (stateCounts.get(e.state) || 0) + 1);
  });
  
  stateCounts.forEach((count, state) => {
    const totalForState = entries.filter(e => e.state === state).length;
    const failRate = count / totalForState;
    if (failRate > 0.5 && count >= 3) {
      patterns.push({
        pattern: `${state} parcels (${Math.round(failRate * 100)}% issues)`,
        count,
        examples: failures.filter(e => e.state === state).slice(0, 2).map(e => e.county)
      });
    }
  });
  
  // Pattern 4: Note-based patterns
  const noteFailures = failures.filter(e => e.note);
  const ridgeIssues = noteFailures.filter(e => e.note?.toLowerCase().includes('ridge'));
  const flowIssues = noteFailures.filter(e => e.note?.toLowerCase().includes('flow'));
  
  if (ridgeIssues.length >= 2) {
    patterns.push({
      pattern: 'Ridge detection issues',
      count: ridgeIssues.length,
      examples: ridgeIssues.slice(0, 2).map(e => e.note?.slice(0, 40) || '')
    });
  }
  
  if (flowIssues.length >= 2) {
    patterns.push({
      pattern: 'Flow direction issues',
      count: flowIssues.length,
      examples: flowIssues.slice(0, 2).map(e => e.note?.slice(0, 40) || '')
    });
  }
  
  return patterns.sort((a, b) => b.count - a.count).slice(0, 5);
}

// ============ QA ANALYTICS PANEL ============

interface QAAnalyticsPanelProps {
  entries: QAEntry[];
  onClose: () => void;
}

export function QAAnalyticsPanel({ entries, onClose }: QAAnalyticsPanelProps) {
  const [activeTab, setActiveTab] = useState<'overview' | 'broker' | 'patterns'>('overview');
  
  // Compute analytics
  const analytics = useMemo(() => {
    if (entries.length === 0) return null;
    
    // State breakdown
    const stateMap = new Map<string, QAEntry[]>();
    entries.forEach(e => {
      const arr = stateMap.get(e.state) || [];
      arr.push(e);
      stateMap.set(e.state, arr);
    });
    
    const stateBreakdown: StateBreakdown[] = Array.from(stateMap.entries()).map(([state, items]) => ({
      state,
      total: items.length,
      believable: items.filter(e => e.rating === 'believable').length,
      mixed: items.filter(e => e.rating === 'mixed').length,
      needsTuning: items.filter(e => e.rating === 'needs_tuning').length,
      successRate: items.filter(e => e.rating === 'believable').length / items.length
    }));
    
    // DEM mode breakdown
    const demMap = new Map<string, QAEntry[]>();
    entries.forEach(e => {
      const mode = e.demMode || 'unknown';
      const arr = demMap.get(mode) || [];
      arr.push(e);
      demMap.set(mode, arr);
    });
    
    const demBreakdown: DEMModeBreakdown[] = Array.from(demMap.entries()).map(([mode, items]) => ({
      mode: mode === 'unknown' ? 'Unknown' : mode,
      total: items.length,
      believable: items.filter(e => e.rating === 'believable').length,
      mixed: items.filter(e => e.rating === 'mixed').length,
      needsTuning: items.filter(e => e.rating === 'needs_tuning').length,
      successRate: items.filter(e => e.rating === 'believable').length / items.length
    }));
    
    // Acreage by rating
    const acreageStats: AcreageStats[] = (['believable', 'mixed', 'needs_tuning'] as QARating[]).map(rating => {
      const items = entries.filter(e => e.rating === rating);
      if (items.length === 0) return { rating, avgAcreage: 0, minAcreage: 0, maxAcreage: 0, count: 0 };
      const acreages = items.map(e => e.acreage);
      return {
        rating,
        avgAcreage: acreages.reduce((a, b) => a + b, 0) / acreages.length,
        minAcreage: Math.min(...acreages),
        maxAcreage: Math.max(...acreages),
        count: items.length
      };
    });
    
    // Keyword extraction
    const notesWithContent = entries.filter(e => e.note).map(e => e.note!);
    const keywords = extractKeywords(notesWithContent);
    
    // Failure patterns
    const failurePatterns = analyzeFailurePatterns(entries);
    
    // ============ BROKER ANALYTICS ============
    const entriesWithBrokerScore = entries.filter(e => e.brokerScore !== undefined);
    const brokerReadyCount = entries.filter(e => e.brokerClass === 'broker_ready').length;
    const potentialDemoCount = entries.filter(e => e.brokerClass === 'potential_demo').length;
    const notBrokerReadyCount = entries.filter(e => e.brokerClass === 'not_broker_ready').length;
    
    const overallBrokerReadyRate = entriesWithBrokerScore.length > 0 
      ? brokerReadyCount / entriesWithBrokerScore.length 
      : 0;
    
    const avgBrokerScore = entriesWithBrokerScore.length > 0
      ? entriesWithBrokerScore.reduce((sum, e) => sum + (e.brokerScore || 0), 0) / entriesWithBrokerScore.length
      : 0;
    
    // Broker by state
    const brokerByState = Array.from(stateMap.entries()).map(([state, items]) => {
      const withScore = items.filter(e => e.brokerScore !== undefined);
      const ready = items.filter(e => e.brokerClass === 'broker_ready').length;
      return {
        state,
        total: items.length,
        brokerReady: ready,
        brokerReadyRate: withScore.length > 0 ? ready / withScore.length : 0,
        avgScore: withScore.length > 0 
          ? withScore.reduce((sum, e) => sum + (e.brokerScore || 0), 0) / withScore.length 
          : 0
      };
    });
    
    // Broker by DEM mode
    const brokerByDEM = Array.from(demMap.entries()).map(([mode, items]) => {
      const withScore = items.filter(e => e.brokerScore !== undefined);
      const ready = items.filter(e => e.brokerClass === 'broker_ready').length;
      return {
        mode: mode === 'unknown' ? 'Unknown' : mode,
        total: items.length,
        brokerReady: ready,
        brokerReadyRate: withScore.length > 0 ? ready / withScore.length : 0,
        avgScore: withScore.length > 0 
          ? withScore.reduce((sum, e) => sum + (e.brokerScore || 0), 0) / withScore.length 
          : 0
      };
    });
    
    // Broker by acreage band
    const acreageBands = [
      { label: '<80 ac', min: 0, max: 80 },
      { label: '80-200 ac', min: 80, max: 200 },
      { label: '>200 ac', min: 200, max: Infinity }
    ];
    const brokerByAcreage = acreageBands.map(band => {
      const items = entries.filter(e => e.acreage >= band.min && e.acreage < band.max);
      const withScore = items.filter(e => e.brokerScore !== undefined);
      const ready = items.filter(e => e.brokerClass === 'broker_ready').length;
      return {
        label: band.label,
        total: items.length,
        brokerReady: ready,
        brokerReadyRate: withScore.length > 0 ? ready / withScore.length : 0
      };
    });
    
    // Human vs broker correlation
    const believableAvgBrokerScore = entriesWithBrokerScore.filter(e => e.rating === 'believable').length > 0
      ? entriesWithBrokerScore.filter(e => e.rating === 'believable').reduce((sum, e) => sum + (e.brokerScore || 0), 0) / entriesWithBrokerScore.filter(e => e.rating === 'believable').length
      : 0;
    const needsTuningAvgBrokerScore = entriesWithBrokerScore.filter(e => e.rating === 'needs_tuning').length > 0
      ? entriesWithBrokerScore.filter(e => e.rating === 'needs_tuning').reduce((sum, e) => sum + (e.brokerScore || 0), 0) / entriesWithBrokerScore.filter(e => e.rating === 'needs_tuning').length
      : 0;
    
    return {
      stateBreakdown,
      demBreakdown,
      acreageStats,
      keywords,
      failurePatterns,
      overallSuccessRate: entries.filter(e => e.rating === 'believable').length / entries.length,
      // Broker analytics
      hasBrokerData: entriesWithBrokerScore.length > 0,
      brokerReadyCount,
      potentialDemoCount,
      notBrokerReadyCount,
      overallBrokerReadyRate,
      avgBrokerScore,
      brokerByState,
      brokerByDEM,
      brokerByAcreage,
      believableAvgBrokerScore,
      needsTuningAvgBrokerScore
    };
  }, [entries]);
  
  if (!analytics || entries.length < 5) {
    return (
      <div className="bg-gray-900/95 backdrop-blur-sm border border-indigo-500/30 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-indigo-400" />
            <span className="text-sm font-medium text-white">QA Analytics</span>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-white/10 rounded">
            <X className="h-4 w-4 text-gray-500" />
          </button>
        </div>
        <div className="text-xs text-gray-400 text-center py-4">
          Need at least 5 rated parcels to show analytics.<br />
          Currently: {entries.length} tested
        </div>
      </div>
    );
  }
  
  return (
    <div className="bg-gray-900/95 backdrop-blur-sm border border-indigo-500/30 rounded-xl overflow-hidden max-h-[70vh] flex flex-col">
      {/* Header */}
      <div className="px-4 py-2.5 bg-gradient-to-r from-indigo-900/40 to-gray-900/40 border-b border-indigo-500/20 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-indigo-400" />
          <span className="text-sm font-medium text-white">QA Analytics</span>
          <span className="text-xs text-indigo-400 bg-indigo-500/20 px-2 py-0.5 rounded-full">
            {entries.length} parcels
          </span>
        </div>
        <button onClick={onClose} className="p-1 hover:bg-white/10 rounded transition-colors">
          <X className="h-4 w-4 text-gray-500" />
        </button>
      </div>
      
      {/* Tabs */}
      <div className="flex border-b border-gray-800 flex-shrink-0">
        <button
          onClick={() => setActiveTab('overview')}
          className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
            activeTab === 'overview' 
              ? 'text-indigo-400 border-b-2 border-indigo-500' 
              : 'text-gray-500 hover:text-gray-300'
          }`}
        >
          Overview
        </button>
        <button
          onClick={() => setActiveTab('broker')}
          className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
            activeTab === 'broker' 
              ? 'text-emerald-400 border-b-2 border-emerald-500' 
              : 'text-gray-500 hover:text-gray-300'
          }`}
        >
          Broker
        </button>
        <button
          onClick={() => setActiveTab('patterns')}
          className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
            activeTab === 'patterns' 
              ? 'text-indigo-400 border-b-2 border-indigo-500' 
              : 'text-gray-500 hover:text-gray-300'
          }`}
        >
          Patterns
        </button>
      </div>
      
      {/* Content */}
      <div className="overflow-y-auto flex-1 p-3 space-y-4">
        {activeTab === 'overview' ? (
          <>
            {/* Overall Success Rate */}
            <div className="bg-gray-800/50 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-gray-400">Overall Success Rate</span>
                <span className={`text-lg font-bold ${
                  analytics.overallSuccessRate >= 0.7 ? 'text-emerald-400' :
                  analytics.overallSuccessRate >= 0.4 ? 'text-amber-400' : 'text-red-400'
                }`}>
                  {Math.round(analytics.overallSuccessRate * 100)}%
                </span>
              </div>
              <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                <div 
                  className={`h-full transition-all ${
                    analytics.overallSuccessRate >= 0.7 ? 'bg-emerald-500' :
                    analytics.overallSuccessRate >= 0.4 ? 'bg-amber-500' : 'bg-red-500'
                  }`}
                  style={{ width: `${analytics.overallSuccessRate * 100}%` }}
                />
              </div>
            </div>
            
            {/* State Breakdown */}
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <MapPin className="h-3.5 w-3.5 text-blue-400" />
                <span className="text-xs font-medium text-white">By State</span>
              </div>
              <div className="space-y-1.5">
                {analytics.stateBreakdown.map(s => (
                  <div key={s.state} className="bg-gray-800/30 rounded px-2.5 py-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-white font-medium">{s.state}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-gray-500">{s.total} tested</span>
                        <span className={`font-medium ${
                          s.successRate >= 0.7 ? 'text-emerald-400' :
                          s.successRate >= 0.4 ? 'text-amber-400' : 'text-red-400'
                        }`}>
                          {Math.round(s.successRate * 100)}%
                        </span>
                      </div>
                    </div>
                    <div className="flex gap-3 mt-1 text-[10px]">
                      <span className="text-emerald-400">✓{s.believable}</span>
                      <span className="text-amber-400">~{s.mixed}</span>
                      <span className="text-red-400">!{s.needsTuning}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            
            {/* DEM Mode Breakdown */}
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <Cpu className="h-3.5 w-3.5 text-cyan-400" />
                <span className="text-xs font-medium text-white">By DEM Mode</span>
              </div>
              <div className="space-y-1.5">
                {analytics.demBreakdown.map(d => (
                  <div key={d.mode} className="bg-gray-800/30 rounded px-2.5 py-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-white font-medium capitalize">{d.mode.replace(/_/g, ' ')}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-gray-500">{d.total}</span>
                        <span className={`font-medium ${
                          d.successRate >= 0.7 ? 'text-emerald-400' :
                          d.successRate >= 0.4 ? 'text-amber-400' : 'text-red-400'
                        }`}>
                          {Math.round(d.successRate * 100)}%
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            
            {/* Acreage by Rating */}
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <Scale className="h-3.5 w-3.5 text-purple-400" />
                <span className="text-xs font-medium text-white">Avg Acreage by Rating</span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                {analytics.acreageStats.filter(s => s.count > 0).map(s => (
                  <div key={s.rating} className={`rounded px-2 py-1.5 ${
                    s.rating === 'believable' ? 'bg-emerald-500/10 border border-emerald-500/30' :
                    s.rating === 'mixed' ? 'bg-amber-500/10 border border-amber-500/30' :
                    'bg-red-500/10 border border-red-500/30'
                  }`}>
                    <div className={`text-lg font-bold ${
                      s.rating === 'believable' ? 'text-emerald-400' :
                      s.rating === 'mixed' ? 'text-amber-400' : 'text-red-400'
                    }`}>
                      {s.avgAcreage.toFixed(0)}
                    </div>
                    <div className="text-[10px] text-gray-500">
                      {s.minAcreage.toFixed(0)}-{s.maxAcreage.toFixed(0)} ac
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : activeTab === 'broker' ? (
          <>
            {/* Broker Ready Rate */}
            {analytics.hasBrokerData ? (
              <>
                <div className="bg-gray-800/50 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5">
                      <Briefcase className="h-3.5 w-3.5 text-emerald-400" />
                      <span className="text-xs text-gray-400">Broker Ready Rate</span>
                    </div>
                    <span className={`text-lg font-bold ${
                      analytics.overallBrokerReadyRate >= 0.5 ? 'text-emerald-400' :
                      analytics.overallBrokerReadyRate >= 0.3 ? 'text-amber-400' : 'text-slate-400'
                    }`}>
                      {Math.round(analytics.overallBrokerReadyRate * 100)}%
                    </span>
                  </div>
                  <div className="h-2 bg-gray-700 rounded-full overflow-hidden flex">
                    {analytics.brokerReadyCount > 0 && (
                      <div 
                        className="bg-emerald-500 h-full" 
                        style={{ width: `${(analytics.brokerReadyCount / entries.length) * 100}%` }} 
                      />
                    )}
                    {analytics.potentialDemoCount > 0 && (
                      <div 
                        className="bg-amber-500 h-full" 
                        style={{ width: `${(analytics.potentialDemoCount / entries.length) * 100}%` }} 
                      />
                    )}
                    {analytics.notBrokerReadyCount > 0 && (
                      <div 
                        className="bg-slate-500 h-full" 
                        style={{ width: `${(analytics.notBrokerReadyCount / entries.length) * 100}%` }} 
                      />
                    )}
                  </div>
                  <div className="flex justify-between mt-2 text-[10px]">
                    <span className="text-emerald-400">Ready: {analytics.brokerReadyCount}</span>
                    <span className="text-amber-400">Potential: {analytics.potentialDemoCount}</span>
                    <span className="text-slate-400">No: {analytics.notBrokerReadyCount}</span>
                  </div>
                  <div className="mt-2 pt-2 border-t border-gray-700 text-xs text-gray-400">
                    Avg Score: <span className="text-white font-medium">{(analytics.avgBrokerScore * 100).toFixed(0)}</span>
                  </div>
                </div>
                
                {/* Broker by State */}
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <MapPin className="h-3.5 w-3.5 text-blue-400" />
                    <span className="text-xs font-medium text-white">Broker Ready by State</span>
                  </div>
                  <div className="space-y-1.5">
                    {analytics.brokerByState.map(s => (
                      <div key={s.state} className="bg-gray-800/30 rounded px-2.5 py-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-white font-medium">{s.state}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-gray-500">{s.brokerReady}/{s.total}</span>
                            <span className={`font-medium ${
                              s.brokerReadyRate >= 0.5 ? 'text-emerald-400' :
                              s.brokerReadyRate >= 0.3 ? 'text-amber-400' : 'text-slate-400'
                            }`}>
                              {Math.round(s.brokerReadyRate * 100)}%
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                
                {/* Broker by DEM Mode */}
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <Cpu className="h-3.5 w-3.5 text-cyan-400" />
                    <span className="text-xs font-medium text-white">Broker Ready by DEM Mode</span>
                  </div>
                  <div className="space-y-1.5">
                    {analytics.brokerByDEM.map(d => (
                      <div key={d.mode} className="bg-gray-800/30 rounded px-2.5 py-1.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-white font-medium capitalize">{d.mode.replace(/_/g, ' ')}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-gray-500">{d.brokerReady}/{d.total}</span>
                            <span className={`font-medium ${
                              d.brokerReadyRate >= 0.5 ? 'text-emerald-400' :
                              d.brokerReadyRate >= 0.3 ? 'text-amber-400' : 'text-slate-400'
                            }`}>
                              {Math.round(d.brokerReadyRate * 100)}%
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                
                {/* Broker by Acreage Band */}
                <div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <Scale className="h-3.5 w-3.5 text-purple-400" />
                    <span className="text-xs font-medium text-white">Broker Ready by Acreage</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    {analytics.brokerByAcreage.filter(b => b.total > 0).map(b => (
                      <div key={b.label} className={`rounded px-2 py-1.5 ${
                        b.brokerReadyRate >= 0.5 ? 'bg-emerald-500/10 border border-emerald-500/30' :
                        b.brokerReadyRate >= 0.3 ? 'bg-amber-500/10 border border-amber-500/30' :
                        'bg-slate-500/10 border border-slate-500/30'
                      }`}>
                        <div className="text-[10px] text-gray-400 mb-0.5">{b.label}</div>
                        <div className={`text-sm font-bold ${
                          b.brokerReadyRate >= 0.5 ? 'text-emerald-400' :
                          b.brokerReadyRate >= 0.3 ? 'text-amber-400' : 'text-slate-400'
                        }`}>
                          {Math.round(b.brokerReadyRate * 100)}%
                        </div>
                        <div className="text-[10px] text-gray-500">{b.brokerReady}/{b.total}</div>
                      </div>
                    ))}
                  </div>
                </div>
                
                {/* Human vs Broker Correlation */}
                <div className="bg-emerald-900/20 border border-emerald-500/20 rounded-lg p-3">
                  <div className="text-xs font-medium text-emerald-300 mb-2">Human vs Broker Correlation</div>
                  <div className="space-y-1.5 text-[11px]">
                    <div className="flex justify-between">
                      <span className="text-gray-400">Believable parcels avg broker score:</span>
                      <span className={`font-medium ${analytics.believableAvgBrokerScore >= 0.6 ? 'text-emerald-400' : 'text-amber-400'}`}>
                        {(analytics.believableAvgBrokerScore * 100).toFixed(0)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Needs Tuning avg broker score:</span>
                      <span className={`font-medium ${analytics.needsTuningAvgBrokerScore >= 0.6 ? 'text-amber-400' : 'text-slate-400'}`}>
                        {(analytics.needsTuningAvgBrokerScore * 100).toFixed(0)}
                      </span>
                    </div>
                    {analytics.believableAvgBrokerScore > analytics.needsTuningAvgBrokerScore && (
                      <div className="mt-1 pt-1 border-t border-emerald-500/20 text-emerald-300">
                        ✓ Correlation validated: human ratings align with broker scores
                      </div>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="text-center py-8 text-gray-500 text-xs">
                No broker score data yet.<br />
                Run terrain analysis on parcels to generate broker scores.
              </div>
            )}
          </>
        ) : (
          <>
            {/* Failure Patterns */}
            {analytics.failurePatterns.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
                  <span className="text-xs font-medium text-white">Top Failure Patterns</span>
                </div>
                <div className="space-y-2">
                  {analytics.failurePatterns.map((p, idx) => (
                    <div key={idx} className="bg-red-900/20 border border-red-500/20 rounded px-2.5 py-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-red-300 font-medium">{p.pattern}</span>
                        <span className="text-[10px] text-red-400 bg-red-500/20 px-1.5 py-0.5 rounded">
                          {p.count}×
                        </span>
                      </div>
                      {p.examples.length > 0 && (
                        <div className="text-[10px] text-gray-500 mt-1">
                          e.g., {p.examples.join(', ')}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {/* Note Keywords */}
            {analytics.keywords.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <Tag className="h-3.5 w-3.5 text-amber-400" />
                  <span className="text-xs font-medium text-white">Common Keywords in Notes</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {analytics.keywords.map(k => (
                    <span 
                      key={k.keyword}
                      className="px-2 py-1 bg-gray-800 rounded text-[10px] text-gray-300 border border-gray-700"
                      title={k.contexts.join('\n')}
                    >
                      {k.keyword} <span className="text-gray-500">({k.count})</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
            
            {/* Summary Insights */}
            <div className="bg-indigo-900/20 border border-indigo-500/20 rounded-lg p-3">
              <div className="text-xs font-medium text-indigo-300 mb-2">Quick Insights</div>
              <ul className="text-[11px] text-gray-400 space-y-1">
                {analytics.stateBreakdown.length > 1 && (
                  <li>
                    • Best state: <span className="text-white">
                      {analytics.stateBreakdown.sort((a, b) => b.successRate - a.successRate)[0].state}
                    </span> ({Math.round(analytics.stateBreakdown.sort((a, b) => b.successRate - a.successRate)[0].successRate * 100)}% success)
                  </li>
                )}
                {analytics.demBreakdown.length > 1 && (
                  <li>
                    • Best DEM mode: <span className="text-white capitalize">
                      {analytics.demBreakdown.sort((a, b) => b.successRate - a.successRate)[0].mode.replace(/_/g, ' ')}
                    </span>
                  </li>
                )}
                {analytics.acreageStats.find(s => s.rating === 'believable')?.count && (
                  <li>
                    • Believable parcels avg: <span className="text-white">
                      {analytics.acreageStats.find(s => s.rating === 'believable')?.avgAcreage.toFixed(0)} ac
                    </span>
                  </li>
                )}
                {analytics.failurePatterns.length > 0 && (
                  <li>
                    • Top issue: <span className="text-red-400">
                      {analytics.failurePatterns[0].pattern}
                    </span>
                  </li>
                )}
              </ul>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
