import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Calendar, dateFnsLocalizer } from 'react-big-calendar';
import format from 'date-fns/format';
import parse from 'date-fns/parse';
import startOfWeek from 'date-fns/startOfWeek';
import getDay from 'date-fns/getDay';
import enUS from 'date-fns/locale/en-US';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import { api } from '../api.js';
import ConflictBanner from './ConflictBanner.jsx';

const locales = { 'en-US': enUS };
const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: () => startOfWeek(new Date(), { weekStartsOn: 0 }),
  getDay,
  locales,
});

const CATEGORY_COLOR = {
  work: '#2563eb',
  school: '#ea580c',
  personal: '#16a34a',
};

export default function CalendarView() {
  const [events, setEvents] = useState([]);
  const [conflictSuggestions, setConflictSuggestions] = useState([]);
  const [conflictPairs, setConflictPairs] = useState([]);
  const [lastSynced, setLastSynced] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [weekData, suggestionData] = await Promise.all([
        api.get('/calendar/week'),
        api.get('/calendar/suggestions'),
      ]);
      setEvents(weekData.events);
      setConflictPairs(weekData.conflicts);
      setConflictSuggestions(suggestionData.conflicts);
      setLastSynced(weekData.lastSynced);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const conflictedIds = useMemo(() => {
    const ids = new Set();
    conflictPairs.forEach((p) => {
      ids.add(p.eventA.id);
      ids.add(p.eventB.id);
    });
    return ids;
  }, [conflictPairs]);

  const calendarEvents = useMemo(
    () =>
      events.map((ev) => ({
        id: ev.id,
        title: ev.title,
        start: new Date(ev.start),
        end: new Date(ev.end),
        allDay: ev.allDay,
        resource: ev,
      })),
    [events]
  );

  function eventPropGetter(event) {
    const conflicted = conflictedIds.has(event.id);
    const color = conflicted ? '#dc2626' : CATEGORY_COLOR[event.resource.category] || '#64748b';
    return {
      style: {
        backgroundColor: color,
        color: 'white',
        border: conflicted ? '2px solid #7f1d1d' : 'none',
      },
    };
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Calendar</h2>
          <p className="text-sm text-slate-500">
            Last synced {lastSynced ? new Date(`${lastSynced.replace(' ', 'T')}Z`).toLocaleString() : 'never'}
          </p>
        </div>
        <div className="flex gap-3 text-xs text-slate-600">
          <Legend color="#2563eb" label="Work" />
          <Legend color="#ea580c" label="School" />
          <Legend color="#16a34a" label="Personal" />
          <Legend color="#dc2626" label="Conflict" />
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{error}</div>}

      {conflictSuggestions.length > 0 && (
        <div className="space-y-2">
          {conflictSuggestions.map((c) => (
            <ConflictBanner key={c.id} conflict={c} onChanged={load} />
          ))}
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl p-2 md:p-4" style={{ height: 650 }}>
        {loading ? (
          <p className="text-slate-500 p-4">Loading calendar…</p>
        ) : (
          <Calendar
            localizer={localizer}
            events={calendarEvents}
            defaultView="week"
            views={['week', 'day', 'agenda']}
            startAccessor="start"
            endAccessor="end"
            eventPropGetter={eventPropGetter}
            style={{ height: '100%' }}
          />
        )}
      </div>
    </div>
  );
}

function Legend({ color, label }) {
  return (
    <span className="flex items-center gap-1">
      <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}
