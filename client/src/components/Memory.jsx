import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';

const CATEGORIES = ['general', 'preference', 'fact', 'routine', 'people', 'goal'];
const CATEGORY_LABELS = {
  general: 'General',
  preference: 'Preference',
  fact: 'Fact',
  routine: 'Routine',
  people: 'People',
  goal: 'Goal',
};

export default function Memory() {
  const [memories, setMemories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [content, setContent] = useState('');
  const [category, setCategory] = useState('general');
  const [filter, setFilter] = useState('all');

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await api.get('/memory');
      setMemories(data.memories);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function addMemory(e) {
    e.preventDefault();
    if (!content.trim()) return;
    try {
      await api.post('/memory', { content: content.trim(), category });
      setContent('');
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function togglePin(m) {
    try {
      await api.put(`/memory/${m.id}`, { pinned: m.pinned ? 0 : 1 });
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove(id) {
    try {
      await api.delete(`/memory/${id}`);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  const visible = filter === 'all' ? memories : memories.filter((m) => m.category === filter);

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h2 className="text-2xl font-bold text-slate-800">Memory</h2>
        <p className="text-sm text-slate-500 mt-1">
          What your agent knows about you — used to personalize briefings, suggestions, and chat. Claude also adds
          to this automatically during conversations when you mention something worth remembering.
        </p>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{error}</div>}

      <form onSubmit={addMemory} className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder='e.g. "Prefers not to schedule anything before 9am" or "Roommate is named Jordan"'
          rows={2}
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <div className="flex items-center gap-2 flex-wrap">
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="border border-slate-300 rounded-lg px-2 py-1.5 text-sm">
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
            ))}
          </select>
          <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium px-4 py-1.5 rounded-lg">
            Add Memory
          </button>
        </div>
      </form>

      <div className="flex gap-2 flex-wrap">
        <FilterChip active={filter === 'all'} onClick={() => setFilter('all')} label="All" />
        {CATEGORIES.map((c) => (
          <FilterChip key={c} active={filter === c} onClick={() => setFilter(c)} label={CATEGORY_LABELS[c]} />
        ))}
      </div>

      {loading ? (
        <p className="text-slate-500">Loading memory…</p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-slate-500">Nothing here yet.</p>
      ) : (
        <div className="space-y-2">
          {visible.map((m) => (
            <div key={m.id} className="bg-white border border-slate-200 rounded-xl p-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm text-slate-800">{m.content}</p>
                <p className="text-xs text-slate-400 mt-1">
                  {CATEGORY_LABELS[m.category] || m.category} · {m.source === 'chat' ? 'learned in chat' : 'added manually'}
                </p>
              </div>
              <div className="flex gap-1 flex-shrink-0">
                <button
                  onClick={() => togglePin(m)}
                  title={m.pinned ? 'Unpin' : 'Pin'}
                  className={`text-sm px-2 py-1 rounded-lg ${m.pinned ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
                >
                  📌
                </button>
                <button
                  onClick={() => remove(m.id)}
                  title="Delete"
                  className="text-sm px-2 py-1 rounded-lg bg-slate-100 text-slate-500 hover:bg-red-100 hover:text-red-600"
                >
                  ✕
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FilterChip({ active, onClick, label }) {
  return (
    <button
      onClick={onClick}
      className={`text-sm font-medium px-3 py-1.5 rounded-full border ${
        active ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
      }`}
    >
      {label}
    </button>
  );
}
