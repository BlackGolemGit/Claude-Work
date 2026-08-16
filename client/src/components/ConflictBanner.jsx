import React, { useState } from 'react';
import { api } from '../api.js';

export default function ConflictBanner({ conflict, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const meta = conflict.metadata || {};

  async function accept() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/calendar/conflicts/${conflict.id}/accept`);
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function dismiss() {
    setBusy(true);
    try {
      await api.post(`/calendar/suggestions/${conflict.id}/dismiss`);
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border border-red-300 bg-red-50 rounded-xl p-4">
      <div className="flex items-start gap-2">
        <span className="text-red-600 text-lg leading-none">⚠️</span>
        <div className="flex-1">
          <p className="font-semibold text-red-800 text-sm">
            Conflict: "{meta.eventATitle}" overlaps "{meta.eventBTitle}"
          </p>
          <p className="text-sm text-red-700 mt-1">{conflict.content}</p>
          {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
          <div className="mt-3 flex gap-2">
            <button
              onClick={accept}
              disabled={busy || !meta.moveEventId}
              title={!meta.moveEventId ? 'No automatic fix available — resolve manually on the Calendar tab.' : ''}
              className="text-xs font-medium bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg"
            >
              Accept Suggested Fix
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
      </div>
    </div>
  );
}
