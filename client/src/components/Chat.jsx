import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';

const TOOL_LABELS = {
  schedule_event: '📅 Scheduled an event',
  move_event: '↔️ Moved an event',
  delete_event: '🗑️ Deleted an event',
  mark_homework_complete: '✅ Marked homework complete',
  get_next_work_shift: '🏢 Looked up your next shift',
};

export default function Chat() {
  const [messages, setMessages] = useState([]); // { role, content, pending? }
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    api
      .get('/chat/history')
      .then((data) => setMessages(data.history.map((h) => ({ role: h.role, content: h.content }))))
      .catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || streaming) return;
    setInput('');
    setError(null);
    setMessages((prev) => [...prev, { role: 'user', content: text }, { role: 'assistant', content: '', pending: true }]);
    setStreaming(true);

    try {
      const res = await fetch('/api/chat/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Chat request failed (${res.status})`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split('\n\n');
        buffer = chunks.pop(); // keep the last (possibly incomplete) chunk in the buffer

        for (const chunk of chunks) {
          const line = chunk.trim();
          if (!line.startsWith('data:')) continue;
          const payload = JSON.parse(line.slice(5).trim());

          if (payload.type === 'token') {
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              next[next.length - 1] = { ...last, content: last.content + payload.text };
              return next;
            });
          } else if (payload.type === 'tool') {
            const label = TOOL_LABELS[payload.name] || `🔧 Ran ${payload.name}`;
            setMessages((prev) => [...prev, { role: 'system', content: label }]);
          } else if (payload.type === 'error') {
            setError(payload.message);
          }
        }
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setStreaming(false);
      setMessages((prev) => prev.map((m) => ({ ...m, pending: false })));
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] md:h-[calc(100vh-4rem)]">
      <h2 className="text-2xl font-bold text-slate-800 mb-4">Chat</h2>

      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-3 bg-white border border-slate-200 rounded-xl p-4">
        {messages.length === 0 && (
          <p className="text-sm text-slate-400">
            Ask me anything — "What's on my calendar tomorrow?", "Schedule a dentist appointment Friday at 2pm",
            "Mark my calc homework as done", or "When's my next shift?"
          </p>
        )}
        {messages.map((m, i) => (
          <ChatBubble key={i} message={m} />
        ))}
      </div>

      {error && <div className="mt-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-2">{error}</div>}

      <div className="mt-3 flex gap-2 items-end">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a message…"
          rows={1}
          className="flex-1 resize-none border border-slate-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          onClick={send}
          disabled={streaming || !input.trim()}
          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-medium px-5 py-3 rounded-xl text-sm"
        >
          Send
        </button>
      </div>
    </div>
  );
}

function ChatBubble({ message }) {
  if (message.role === 'system') {
    return <div className="text-xs text-center text-slate-400 italic">{message.content}</div>;
  }
  const isUser = message.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap ${
          isUser ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-800'
        }`}
      >
        {message.content || (message.pending ? '…' : '')}
      </div>
    </div>
  );
}
