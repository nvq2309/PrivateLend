import React, { useEffect, useState } from 'react';
import { NoteRecord } from '../sdk/notes';

const NOTE_STORAGE_PREFIX = 'veillend.note';

export const SavedNotes: React.FC = () => {
  const [savedNotes, setSavedNotes] = useState<Array<Partial<NoteRecord> & { noteString?: string }>>([]);

  useEffect(() => {
    if (typeof localStorage === 'undefined') return;

    const notes: NoteRecord[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(NOTE_STORAGE_PREFIX)) {
        try {
          const raw = localStorage.getItem(key);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed.noteString === 'string' && parsed.noteString.length > 0) {
              notes.push(parsed);
            }
          }
        } catch (e) {
          console.warn('Failed to parse note', e);
        }
      }
    }
    // Sort by updated most recently
    setSavedNotes(notes.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0)));
  }, []);

  const copyToClipboard = async (text: string) => {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      alert('Note copied to clipboard!');
    }
  };

  if (savedNotes.length === 0) return null;

  return (
    <div className="mt-8 p-6 rounded-2xl bg-white/5 border border-white/10 relative z-10">
      <h3 className="text-sm font-bold text-slate-300 uppercase tracking-widest mb-4">
        Saved Notes (Local Storage)
      </h3>
      <div className="space-y-3">
        {savedNotes.map((note, index) => (
          <div key={note.noteHash ?? note.noteString ?? String(index)} className="p-4 bg-black/20 rounded-xl border border-white/5 flex justify-between items-center">
            <div>
              <p className="text-xs text-slate-400 font-mono mb-1">
                {new Date(note.updatedAt ?? 0).toLocaleString()}
              </p>
              {note.walletAddress ? (
                <p className="text-xs font-bold text-emerald-400">
                  {note.walletAddress.slice(0, 6)}...{note.walletAddress.slice(-4)}
                </p>
              ) : (
                <p className="text-xs font-bold text-slate-400">Wallet unavailable</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => copyToClipboard(note.noteString || '')}
              className="px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded-lg text-xs font-bold transition-colors"
            >
              Copy Note
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
