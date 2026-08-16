import React, { useCallback, useEffect, useState } from 'react';
import RSVPCard from './RSVPCard.jsx';
import SuggestionCard from './SuggestionCard.jsx';
import ConflictBanner from './ConflictBanner.jsx';
import { api } from '../api.js';

const CATEGORY_COLORS = {
  work: 'bg-work',
  school: 'bg-school',
  personal: 'bg-personal',
};

function formatTime(dt, allDay) {
  if (allDay) return 'All day';
  try {
    return new Date(dt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch {
    return dt;
  }
}

function timeAgo(iso) {
  if (!iso) return 'never';
  const diffMs = Date.now() - new Date(`${iso.replace(' ', 'T')}Z`).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export default function Dashboard({ onNavigate }) {
  const [today, setToday] = useState({ events: [], conflicts: [], lastSynced: null });
  const [rsvps, setRsvps] = useState([]);
  const [schoolTasks, setSchoolTasks] = useState([]);
  const [nextShift, setNextShift] = useState(null);
  const [suggestions, setSuggestions] = useState({ lifeBalance: [], conflicts: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [syncing, setSyncing] = useState(false);

  const loadAll = useCallback(async () => {
    setError(null);
    try {
      const [todayData, rsvpData, schoolData, shiftData, suggestionData] = await Promise.all([
        api.get('/calendar/today'),
        api.get('/gmail/rsvps'),
        api.get('/school/tasks/upcoming'),
        api.get('/hotschedules/shifts/next'),
        api.get('/calendar/suggestions'),
      ]);
      setToday(todayData);
      setRsvps(rsvpData.rsvps.filter((r) => r.status === 'pending'));
      setSchoolTasks(schoolData.tasks);
      setNextShift(shiftData.shift);
      setSuggestions(suggestionData);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  async function runSync() {
    setSyncing(true);
    try {
      await api.post('/calendar/sync');
      await loadAll();
    } catch (err) {
      setError(err.message);
    } finally {
      setSyncing(false);
    }
  }

  if (loading) return <p className="text-slate-500">Loading your dashboard…</p>;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Dashboard</h2>
          <p className="text-sm text-slate-500">Last synced {timeAgo(today.lastSynced)}</p>
        </div>
        <button
          onClick={runSync}
          disabled={syncing}
          className="text-sm font-medium bg-slate-800 hover:bg-slate-900 disabled:opacity-50 text-white px-4 py-2 rounded-lg"
        >
          {syncing ? 'Syncing…' : '🔄 Sync Now'}
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{error}</div>
      )}

      {suggestions.conflicts.length > 0 && (
        <section className="space-y-2">
          {suggestions.conflicts.map((c) => (
            <ConflictBanner key={c.id} conflict={c} onChanged={loadAll} />
          ))}
        </section>
      )}

      <section>
        <h3 className="font-semibold text-slate-700 mb-3">Today's Agenda</h3>
        {today.events.length === 0 ? (
          <p className="text-sm text-slate-500">Nothing on your calendar today. Enjoy the breathing room!</p>
        ) : (
          <div className="space-y-2">
            {today.events.map((ev) => (
              <div key={ev.id} className="flex items-center gap-3 bg-white border border-slate-200 rounded-xl p-3">
                <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${CATEGORY_COLORS[ev.category] || 'bg-slate-400'}`} />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-slate-800 truncate">{ev.title}</p>
                  {ev.location && <p className="text-xs text-slate-500 truncate">📍 {ev.location}</p>}
                </div>
                <span className="text-sm text-slate-500 whitespace-nowrap">{formatTime(ev.start, ev.allDay)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="grid md:grid-cols-2 gap-8">
        <section>
          <h3 className="font-semibold text-slate-700 mb-3">Pending RSVPs</h3>
          {rsvps.length === 0 ? (
            <p className="text-sm text-slate-500">No pending invitations.</p>
          ) : (
            <div className="space-y-3">
              {rsvps.map((r) => (
                <RSVPCard key={r.id} rsvp={r} onResolved={loadAll} />
              ))}
            </div>
          )}
        </section>

        <section>
          <h3 className="font-semibold text-slate-700 mb-3">Upcoming School Deadlines (7 days)</h3>
          {schoolTasks.length === 0 ? (
            <p className="text-sm text-slate-500">Nothing due this week. 🎉</p>
          ) : (
            <div className="space-y-2">
              {schoolTasks.map((t) => (
                <div key={t.id} className="bg-white border border-slate-200 rounded-xl p-3 flex items-center justify-between">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-800 truncate">
                      {t.type === 'exam' ? '📝' : '📚'} {t.title}
                    </p>
                    <p className="text-xs text-slate-500">{t.course || 'No course'}</p>
                  </div>
                  <span className="text-sm text-orange-600 font-medium whitespace-nowrap ml-2">{t.due_date}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <section>
        <h3 className="font-semibold text-slate-700 mb-3">Next Work Shift</h3>
        {nextShift ? (
          <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center justify-between">
            <div>
              <p className="font-medium text-slate-800">🏢 {nextShift.role || 'Shift'}</p>
              <p className="text-sm text-slate-500">
                {nextShift.date} · {nextShift.start_time}–{nextShift.end_time}
              </p>
              {nextShift.location && <p className="text-sm text-slate-500">📍 {nextShift.location}</p>}
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-500">No upcoming shifts synced yet.</p>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-slate-700">AI Life Balance Suggestions</h3>
        </div>
        {suggestions.lifeBalance.length === 0 ? (
          <p className="text-sm text-slate-500">No suggestions right now — hit Sync Now to refresh.</p>
        ) : (
          <div className="grid md:grid-cols-2 gap-3">
            {suggestions.lifeBalance.map((s) => (
              <SuggestionCard key={s.id} suggestion={s} onChanged={loadAll} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
