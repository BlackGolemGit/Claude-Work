import React, { useState } from 'react';
import { api } from '../api.js';

export default function RSVPCard({ rsvp, onResolved }) {
  const [busy, setBusy] = useState(false);
  const [conflictWarning, setConflictWarning] = useState(null);
  const [error, setError] = useState(null);

  async function accept(force = false) {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/gmail/rsvps/${rsvp.id}/accept`, force ? { force: true } : {});
      setConflictWarning(null);
      onResolved();
    } catch (err) {
      if (err.status === 409 && err.body?.conflict) {
        setConflictWarning(err.body.message);
      } else {
        setError(err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function decline() {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/gmail/rsvps/${rsvp.id}/decline`);
      onResolved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border border-slate-200 rounded-xl p-4 bg-white shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-slate-800">{rsvp.event_title}</h3>
          <p className="text-sm text-slate-500 mt-0.5">
            {rsvp.event_date || 'Date TBD'} {rsvp.event_time ? `· ${rsvp.event_time}` : ''}
          </p>
          {rsvp.event_location && <p className="text-sm text-slate-500">📍 {rsvp.event_location}</p>}
          {rsvp.organizer_email && (
            <p className="text-xs text-slate-400 mt-1">From: {rsvp.organizer_email}</p>
          )}
        </div>
        <span className="text-xs px-2 py-1 rounded-full bg-amber-100 text-amber-700 whitespace-nowrap">
          Pending
        </span>
      </div>

      {conflictWarning && (
        <div className="mt-3 text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg p-2">
          ⚠️ {conflictWarning}
          <button
            onClick={() => accept(true)}
            disabled={busy}
            className="ml-2 underline font-medium hover:text-red-900"
          >
            Accept anyway
          </button>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

      <div className="mt-3 flex gap-2">
        <button
          onClick={() => accept(false)}
          disabled={busy}
          className="flex-1 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white text-sm font-medium py-2 rounded-lg transition-colors"
        >
          Accept
        </button>
        <button
          onClick={decline}
          disabled={busy}
          className="flex-1 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 text-sm font-medium py-2 rounded-lg transition-colors"
        >
          Decline
        </button>
      </div>
    </div>
  );
}
