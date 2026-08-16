import React, { useState } from 'react';
import { api } from '../api.js';

export default function SuggestionCard({ suggestion, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const meta = suggestion.metadata || {};

  async function dismiss() {
    setBusy(true);
    try {
      await api.post(`/calendar/suggestions/${suggestion.id}/dismiss`);
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function addToCalendar() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/calendar/suggestions/${suggestion.id}/add-to-calendar`);
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border border-blue-100 bg-blue-50/60 rounded-xl p-4 relative">
      <button
        onClick={dismiss}
        disabled={busy}
        className="absolute top-2 right-2 text-slate-400 hover:text-slate-600 text-sm"
        aria-label="Dismiss suggestion"
      >
        ✕
      </button>
      {meta.title && <h4 className="font-semibold text-slate-800 pr-6">{meta.title}</h4>}
      <p className="text-sm text-slate-600 mt-1 pr-6">{suggestion.content}</p>
      {meta.suggested_for_date && (
        <p className="text-xs text-slate-500 mt-1">
          {meta.suggested_for_date} {meta.start_time ? `· ${meta.start_time}–${meta.end_time}` : ''}
        </p>
      )}
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
      <div className="mt-3 flex gap-2">
        <button
          onClick={addToCalendar}
          disabled={busy || !meta.start_time}
          className="text-xs font-medium bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg"
        >
          Add to Calendar
        </button>
        <button
          onClick={dismiss}
          disabled={busy}
          className="text-xs font-medium bg-white hover:bg-slate-100 text-slate-600 px-3 py-1.5 rounded-lg border border-slate-200"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
