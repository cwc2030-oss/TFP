'use client';

import React, { useState } from 'react';
import {
  MapPin, X, Copy, Check, Play, Loader2, AlertTriangle,
  Building2, User, FileText, Map, ChevronDown, ChevronUp
} from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface LookupParcel {
  parcelId: string;
  address: string;
  county: string;
  state: string;
  acreage: number;
  owner: string;
  zoning: string;
  coordinates: number[][];
  centroid: [number, number];
  bounds: [[number, number], [number, number]];
  geometryType: 'Polygon' | 'MultiPolygon';
  legalDescription?: string;
  plss?: string;
}

interface ParcelLookupCardProps {
  parcel: LookupParcel;
  isLoading?: boolean;
  isAnalyzing?: boolean;
  onAnalyze: () => void;
  onClear: () => void;
  onCopyInfo: () => void;
  error?: string | null;
}

export default function ParcelLookupCard({
  parcel,
  isLoading = false,
  isAnalyzing = false,
  onAnalyze,
  onClear,
  onCopyInfo,
  error
}: ParcelLookupCardProps) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  
  const handleCopy = () => {
    onCopyInfo();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  
  const formatAcreage = (acres: number) => {
    if (acres >= 100) return Math.round(acres).toLocaleString();
    if (acres >= 10) return acres.toFixed(1);
    return acres.toFixed(2);
  };
  
  return (
    <div className="absolute top-4 left-4 z-50 w-80 bg-gray-900/95 backdrop-blur-sm border border-cyan-500/30 rounded-xl shadow-2xl overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 bg-gradient-to-r from-cyan-900/50 to-gray-900/50 border-b border-cyan-500/20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-cyan-500/20 rounded-lg">
              <MapPin className="h-4 w-4 text-cyan-400" />
            </div>
            <div>
              <div className="text-xs text-cyan-400 font-medium uppercase tracking-wide">QA Parcel</div>
              <div className="text-sm text-white font-semibold">{parcel.county}, {parcel.state}</div>
            </div>
          </div>
          <button
            onClick={onClear}
            className="p-1.5 hover:bg-white/10 rounded-lg transition-colors"
            title="Clear parcel"
          >
            <X className="h-4 w-4 text-gray-400 hover:text-white" />
          </button>
        </div>
      </div>
      
      {/* Main Content */}
      <div className="p-4 space-y-3">
        {/* Address & Acreage */}
        <div>
          <div className="text-sm text-gray-300 leading-tight">{parcel.address}</div>
          <div className="flex items-center gap-3 mt-1.5">
            <span className="text-lg font-bold text-cyan-400">{formatAcreage(parcel.acreage)} ac</span>
            <span className="text-xs text-gray-500">| {parcel.parcelId}</span>
          </div>
        </div>
        
        {/* Quick Stats Row */}
        <div className="grid grid-cols-2 gap-2">
          <div className="flex items-center gap-2 px-2.5 py-1.5 bg-gray-800/50 rounded-lg">
            <User className="h-3.5 w-3.5 text-gray-500" />
            <span className="text-xs text-gray-400 truncate" title={parcel.owner}>
              {parcel.owner.length > 18 ? parcel.owner.substring(0, 16) + '…' : parcel.owner}
            </span>
          </div>
          <div className="flex items-center gap-2 px-2.5 py-1.5 bg-gray-800/50 rounded-lg">
            <Building2 className="h-3.5 w-3.5 text-gray-500" />
            <span className="text-xs text-gray-400">{parcel.zoning}</span>
          </div>
        </div>
        
        {/* Expandable Details */}
        {(parcel.plss || parcel.legalDescription) && (
          <div className="border-t border-gray-700/50 pt-2">
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors w-full"
            >
              <FileText className="h-3 w-3" />
              <span>Details</span>
              {expanded ? <ChevronUp className="h-3 w-3 ml-auto" /> : <ChevronDown className="h-3 w-3 ml-auto" />}
            </button>
            {expanded && (
              <div className="mt-2 space-y-1.5 text-xs text-gray-500">
                {parcel.plss && (
                  <div><span className="text-gray-600">PLSS:</span> {parcel.plss}</div>
                )}
                {parcel.legalDescription && (
                  <div className="leading-relaxed">
                    <span className="text-gray-600">Legal:</span> {parcel.legalDescription.substring(0, 100)}
                    {parcel.legalDescription.length > 100 && '…'}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        
        {/* Error Message */}
        {error && (
          <div className="flex items-start gap-2 px-3 py-2 bg-red-900/30 border border-red-500/30 rounded-lg">
            <AlertTriangle className="h-4 w-4 text-red-400 flex-shrink-0 mt-0.5" />
            <span className="text-xs text-red-300">{error}</span>
          </div>
        )}
        
        {/* Action Buttons */}
        <div className="flex gap-2 pt-1">
          <Button
            onClick={onAnalyze}
            disabled={isAnalyzing || isLoading}
            className="flex-1 bg-gradient-to-r from-cyan-600 to-teal-600 hover:from-cyan-500 hover:to-teal-500 text-white font-medium h-9"
          >
            {isAnalyzing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Analyzing…
              </>
            ) : (
              <>
                <Play className="h-4 w-4 mr-2" />
                Analyze Parcel
              </>
            )}
          </Button>
          <Button
            onClick={handleCopy}
            variant="outline"
            className="h-9 px-3 border-gray-600 bg-gray-800/50 hover:bg-gray-700/50"
            title="Copy parcel info"
          >
            {copied ? (
              <Check className="h-4 w-4 text-green-400" />
            ) : (
              <Copy className="h-4 w-4 text-gray-400" />
            )}
          </Button>
        </div>
        
        {/* Keyboard Hint */}
        <div className="text-center text-xs text-gray-600">
          Press <kbd className="px-1.5 py-0.5 bg-gray-800 rounded text-gray-400">Esc</kbd> to clear
        </div>
      </div>
    </div>
  );
}

// Compact loading state
export function ParcelLookupLoading() {
  return (
    <div className="absolute top-4 left-4 z-50 w-64 bg-gray-900/95 backdrop-blur-sm border border-cyan-500/30 rounded-xl shadow-2xl">
      <div className="px-4 py-3 flex items-center gap-3">
        <div className="p-2 bg-cyan-500/20 rounded-lg">
          <Loader2 className="h-4 w-4 text-cyan-400 animate-spin" />
        </div>
        <div>
          <div className="text-sm text-white font-medium">Looking up parcel…</div>
          <div className="text-xs text-gray-500">Fetching from Regrid</div>
        </div>
      </div>
    </div>
  );
}

// Error state for failed lookup
export function ParcelLookupError({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="absolute top-4 left-4 z-50 w-72 bg-gray-900/95 backdrop-blur-sm border border-amber-500/30 rounded-xl shadow-2xl">
      <div className="px-4 py-3">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-amber-500/20 rounded-lg">
            <AlertTriangle className="h-4 w-4 text-amber-400" />
          </div>
          <div className="flex-1">
            <div className="text-sm text-white font-medium">Parcel Not Found</div>
            <div className="text-xs text-gray-400 mt-1">{message}</div>
          </div>
          <button
            onClick={onDismiss}
            className="p-1 hover:bg-white/10 rounded transition-colors"
          >
            <X className="h-4 w-4 text-gray-500" />
          </button>
        </div>
      </div>
    </div>
  );
}
