'use client';

import React, { useState, useCallback } from 'react';
import {
  ThumbsUp, HelpCircle, Wrench, Copy, Check, X, ChevronDown, ChevronUp,
  FileText, Trash2, Download
} from 'lucide-react';
import { Button } from '@/components/ui/button';

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
}

interface QAScorecardProps {
  parcelId: string;
  state: string;
  county: string;
  acreage: number;
  demMode: string;
  onRatingSubmit: (entry: QAEntry) => void;
  onSkip: () => void;
}

export function QAScorecard({
  parcelId,
  state,
  county,
  acreage,
  demMode,
  onRatingSubmit,
  onSkip
}: QAScorecardProps) {
  const [selectedRating, setSelectedRating] = useState<QARating | null>(null);
  const [note, setNote] = useState('');
  const [submitted, setSubmitted] = useState(false);

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
      note: note.trim() || undefined
    };
    
    onRatingSubmit(entry);
    setSubmitted(true);
  }, [selectedRating, note, parcelId, state, county, acreage, demMode, onRatingSubmit]);

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
}

export function QASessionSummary({ entries, onClear, onExport }: QASessionSummaryProps) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  
  const believable = entries.filter(e => e.rating === 'believable').length;
  const mixed = entries.filter(e => e.rating === 'mixed').length;
  const needsTuning = entries.filter(e => e.rating === 'needs_tuning').length;
  const total = entries.length;
  
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
      </div>
      
      {/* Expanded Entry List */}
      {expanded && (
        <div className="max-h-48 overflow-y-auto">
          {entries.slice().reverse().map((entry, idx) => (
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
                <div className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                  entry.rating === 'believable' ? 'bg-emerald-500/20 text-emerald-400' :
                  entry.rating === 'mixed' ? 'bg-amber-500/20 text-amber-400' :
                  'bg-red-500/20 text-red-400'
                }`}>
                  {entry.rating === 'believable' ? '✓' : entry.rating === 'mixed' ? '~' : '!'}
                </div>
              </div>
              {entry.note && (
                <div className="text-gray-500 mt-1 italic">"{entry.note}"</div>
              )}
            </div>
          ))}
        </div>
      )}
      
      {/* Actions */}
      <div className="px-4 py-2 bg-gray-800/30 flex gap-2">
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
  
  const summary = `SUMMARY\n-------\nBelievable: ${entries.filter(e => e.rating === 'believable').length}\nMixed: ${entries.filter(e => e.rating === 'mixed').length}\nNeeds Tuning: ${entries.filter(e => e.rating === 'needs_tuning').length}\n\n`;
  
  const details = `DETAILS\n-------\n` + entries.map((e, idx) => {
    const rating = e.rating === 'believable' ? '✓ Believable' : 
                   e.rating === 'mixed' ? '~ Mixed' : '! Needs Tuning';
    return `#${idx + 1} | ${e.county}, ${e.state} | ${e.acreage.toFixed(1)} ac | ${e.demMode} | ${rating}${e.note ? ` | "${e.note}"` : ''}`;
  }).join('\n');
  
  return header + summary + details;
}

// Helper to export as CSV
export function exportSessionCSV(entries: QAEntry[]): void {
  const header = 'timestamp,state,county,acreage,parcelId,demMode,rating,note';
  const rows = entries.map(e => 
    `${e.timestamp},${e.state},${e.county},${e.acreage.toFixed(1)},${e.parcelId},${e.demMode},${e.rating},"${(e.note || '').replace(/"/g, '""')}"`
  );
  
  const csv = [header, ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = `tfp-qa-session-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  
  URL.revokeObjectURL(url);
}
