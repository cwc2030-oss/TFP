'use client';

import { useCallback, useRef, useState } from 'react';
import Image from 'next/image';
import { Camera, GripVertical, Trash2, Upload, X, AlertCircle, ChevronDown, Link as LinkIcon } from 'lucide-react';

interface Props {
  listingId: string;
  photos: string[];
  onChange: (photos: string[]) => void;
  maxPhotos?: number;
}

export default function PhotoUploader({ listingId, photos, onChange, maxPhotos = 6 }: Props) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [showUrlFallback, setShowUrlFallback] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
  const MAX_SIZE = 10 * 1024 * 1024;

  const uploadFiles = useCallback(async (files: File[]) => {
    setError(null);

    // Filter and validate
    const valid: File[] = [];
    for (const f of files) {
      if (!ALLOWED_TYPES.includes(f.type)) {
        setError(`${f.name}: Invalid type. Use JPG, PNG, or WebP.`);
        return;
      }
      if (f.size > MAX_SIZE) {
        setError(`${f.name}: Too large (${(f.size / 1024 / 1024).toFixed(1)} MB). Max 10 MB.`);
        return;
      }
      valid.push(f);
    }

    if (photos.length + valid.length > maxPhotos) {
      setError(`Can't exceed ${maxPhotos} photos. You have ${photos.length}, tried to add ${valid.length}.`);
      return;
    }

    setUploading(true);
    const newPhotos = [...photos];

    for (const file of valid) {
      try {
        const form = new FormData();
        form.append('file', file);
        const res = await fetch(`/api/listings/${listingId}/photos`, {
          method: 'POST',
          body: form,
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j?.error ?? `Upload failed (${res.status})`);
        }
        const data = await res.json();
        newPhotos.push(data.url);
      } catch (e: any) {
        setError(e.message ?? 'Upload failed');
        break;
      }
    }

    onChange(newPhotos);
    setUploading(false);
  }, [photos, listingId, maxPhotos, onChange]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) uploadFiles(files);
  }, [uploadFiles]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) uploadFiles(files);
    e.target.value = '';
  }, [uploadFiles]);

  const removePhoto = useCallback(async (url: string) => {
    setError(null);
    try {
      const res = await fetch(`/api/listings/${listingId}/photos`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error ?? `Delete failed (${res.status})`);
      }
      const data = await res.json();
      onChange(data.photos);
    } catch (e: any) {
      setError(e.message ?? 'Delete failed');
    }
  }, [listingId, onChange]);

  // Drag reorder handlers
  const handleReorderDragStart = (idx: number) => {
    setDragIdx(idx);
  };

  const handleReorderDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    setDragOverIdx(idx);
  };

  const handleReorderDrop = async (e: React.DragEvent, dropIdx: number) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === dropIdx) {
      setDragIdx(null);
      setDragOverIdx(null);
      return;
    }

    const newPhotos = [...photos];
    const [moved] = newPhotos.splice(dragIdx, 1);
    newPhotos.splice(dropIdx, 0, moved);

    onChange(newPhotos);
    setDragIdx(null);
    setDragOverIdx(null);

    // Persist reorder to server
    try {
      await fetch(`/api/listings/${listingId}/photos`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ photos: newPhotos }),
      });
    } catch {
      // Reorder saved locally even if server call fails
    }
  };

  const addUrlPhoto = () => {
    const url = urlInput.trim();
    if (!url) return;
    if (photos.length >= maxPhotos) {
      setError(`Maximum ${maxPhotos} photos.`);
      return;
    }
    if (!url.includes('listings/')) {
      setError('URL must include listings/ prefix.');
      return;
    }
    onChange([...photos, url]);
    setUrlInput('');
    setError(null);
  };

  const remaining = maxPhotos - photos.length;

  return (
    <div className="space-y-3">
      {/* Photo grid */}
      {photos.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {photos.map((url, i) => (
            <div
              key={url}
              draggable
              onDragStart={() => handleReorderDragStart(i)}
              onDragOver={(e) => handleReorderDragOver(e, i)}
              onDrop={(e) => handleReorderDrop(e, i)}
              onDragEnd={() => { setDragIdx(null); setDragOverIdx(null); }}
              className={`relative group aspect-[4/3] rounded-lg overflow-hidden border-2 transition-all ${
                dragOverIdx === i && dragIdx !== i
                  ? 'border-emerald-400 scale-[1.02]'
                  : i === 0
                  ? 'border-emerald-600/50'
                  : 'border-stone-700'
              } ${dragIdx === i ? 'opacity-40' : ''}`}
            >
              <Image
                src={url}
                alt={`Photo ${i + 1}`}
                fill
                sizes="(max-width: 640px) 50vw, 33vw"
                className="object-cover"
              />
              {/* Hero badge */}
              {i === 0 && (
                <span className="absolute top-2 left-2 bg-emerald-600 text-white text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded">
                  Cover
                </span>
              )}
              {/* Overlay controls */}
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
                <button
                  type="button"
                  title="Drag to reorder"
                  className="p-1.5 bg-stone-800/90 rounded-md cursor-grab active:cursor-grabbing"
                >
                  <GripVertical className="w-4 h-4 text-stone-300" />
                </button>
                <button
                  type="button"
                  onClick={() => removePhoto(url)}
                  title="Remove photo"
                  className="p-1.5 bg-red-900/90 hover:bg-red-800 rounded-md"
                >
                  <Trash2 className="w-4 h-4 text-red-300" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Drop zone / upload area */}
      {remaining > 0 && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
            dragOver
              ? 'border-emerald-400 bg-emerald-950/30'
              : 'border-stone-700 hover:border-stone-500 bg-stone-900/30 hover:bg-stone-900/50'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            onChange={handleFileSelect}
            className="hidden"
          />
          {uploading ? (
            <div className="flex flex-col items-center gap-2">
              <div className="w-8 h-8 border-2 border-emerald-400 border-t-transparent rounded-full animate-spin" />
              <p className="text-stone-400 text-sm">Uploading…</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              {photos.length === 0 ? (
                <Camera className="w-10 h-10 text-stone-600" />
              ) : (
                <Upload className="w-8 h-8 text-stone-600" />
              )}
              <p className="text-stone-300 text-sm font-medium">
                {photos.length === 0
                  ? 'Drag photos here or click to browse'
                  : `Add more photos (${remaining} remaining)`}
              </p>
              <p className="text-stone-500 text-xs">
                JPG, PNG, or WebP · Max 10 MB each · Up to {maxPhotos} photos
              </p>
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 bg-red-950/50 border border-red-800/50 rounded-lg px-3 py-2">
          <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
          <p className="text-red-300 text-sm">{error}</p>
          <button type="button" onClick={() => setError(null)} className="ml-auto">
            <X className="w-4 h-4 text-red-500 hover:text-red-300" />
          </button>
        </div>
      )}

      {/* Collapsible manual URL fallback */}
      <div>
        <button
          type="button"
          onClick={() => setShowUrlFallback(!showUrlFallback)}
          className="flex items-center gap-1.5 text-stone-500 hover:text-stone-400 text-xs transition-colors"
        >
          <LinkIcon className="w-3 h-3" />
          <span>Paste a URL instead</span>
          <ChevronDown className={`w-3 h-3 transition-transform ${showUrlFallback ? 'rotate-180' : ''}`} />
        </button>
        {showUrlFallback && (
          <div className="mt-2 flex gap-2">
            <input
              type="url"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="https://...listings/..."
              className="flex-1 bg-stone-950 border border-stone-700 rounded-lg px-3 py-2 text-stone-100 text-sm focus:border-emerald-500 focus:outline-none"
            />
            <button
              type="button"
              onClick={addUrlPhoto}
              className="bg-stone-700 hover:bg-stone-600 text-stone-100 px-3 py-2 rounded-lg text-sm"
            >
              Add
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
