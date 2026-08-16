import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'week', label: 'This Week' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'complete', label: 'Complete' },
];

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

export default function SchoolTasks() {
  const [filter, setFilter] = useState('all');
  const [tasks, setTasks] = useState([]);
  const [lastSynced, setLastSynced] = useState(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async (f) => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get(`/school/tasks?filter=${f}`);
      setTasks(data.tasks);
      setLastSynced(data.lastSynced);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(filter);
  }, [filter, load]);

  async function toggleComplete(task) {
    try {
      if (task.status === 'complete') {
        await api.post(`/school/tasks/${task.id}/reopen`);
      } else {
        await api.post(`/school/tasks/${task.id}/complete`);
      }
      load(filter);
    } catch (err) {
      setError(err.message);
    }
  }

  async function scanNow() {
    setScanning(true);
    setError(null);
    try {
      await api.post('/school/scan');
      await load(filter);
    } catch (err) {
      setError(err.message);
    } finally {
      setScanning(false);
    }
  }

  const isOverdue = (task) => task.status === 'pending' && task.due_date < new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">School Tasks</h2>
          <p className="text-sm text-slate-500">Last synced {timeAgo(lastSynced)}</p>
        </div>
        <button
          onClick={scanNow}
          disabled={scanning}
          className="text-sm font-medium bg-slate-800 hover:bg-slate-900 disabled:opacity-50 text-white px-4 py-2 rounded-lg"
        >
          {scanning ? 'Scanning…' : '🔄 Scan Gmail Now'}
        </button>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{error}</div>}

      <div className="flex gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            className={`text-sm font-medium px-3 py-1.5 rounded-full border ${
              filter === f.id ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-slate-500">Loading tasks…</p>
      ) : tasks.length === 0 ? (
        <p className="text-sm text-slate-500">No tasks in this view.</p>
      ) : (
        <div className="space-y-2">
          {tasks.map((t) => (
            <div
              key={t.id}
              className={`bg-white border rounded-xl p-4 flex items-center justify-between gap-3 ${
                isOverdue(t) ? 'border-red-300 bg-red-50/40' : 'border-slate-200'
              }`}
            >
              <div className="min-w-0 flex-1">
                <p className={`font-medium truncate ${t.status === 'complete' ? 'line-through text-slate-400' : 'text-slate-800'}`}>
                  {t.type === 'exam' ? '📝' : '📚'} {t.title}
                </p>
                <p className="text-xs text-slate-500">
                  {t.course || 'No course'} · {t.type} {isOverdue(t) && <span className="text-red-600 font-semibold">· OVERDUE</span>}
                </p>
              </div>
              <span className="text-sm text-slate-500 whitespace-nowrap">{t.due_date}</span>
              <button
                onClick={() => toggleComplete(t)}
                className={`text-xs font-medium px-3 py-1.5 rounded-lg whitespace-nowrap ${
                  t.status === 'complete'
                    ? 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    : 'bg-green-600 text-white hover:bg-green-700'
                }`}
              >
                {t.status === 'complete' ? 'Reopen' : 'Mark Complete'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
