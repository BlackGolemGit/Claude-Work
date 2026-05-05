/* global state */
let token = null;
let currentUser = null;
let currentConvId = null;
let streaming = false;
let conversations = [];

/* ── Auth helpers ─────────────────────────────────────────────────────────── */

function saveSession(accessToken, user) {
  token = accessToken;
  currentUser = user;
  localStorage.setItem('llm_token', accessToken);
  localStorage.setItem('llm_user', JSON.stringify(user));
}

function clearSession() {
  token = null;
  currentUser = null;
  currentConvId = null;
  localStorage.removeItem('llm_token');
  localStorage.removeItem('llm_user');
}

async function apiFetch(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...opts.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  let resp = await fetch(path, { ...opts, headers });

  if (resp.status === 401) {
    // Try refresh via cookie
    const r = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
    if (r.ok) {
      const data = await r.json();
      token = data.access_token;
      localStorage.setItem('llm_token', token);
      headers['Authorization'] = `Bearer ${token}`;
      resp = await fetch(path, { ...opts, headers });
    } else {
      showLogin();
      throw new Error('Session expired');
    }
  }
  return resp;
}

/* ── Login / logout ──────────────────────────────────────────────────────── */

function showLogin() {
  clearSession();
  document.getElementById('login-overlay').classList.remove('hidden');
  document.getElementById('login-error').textContent = '';
}

function hideLogin() {
  document.getElementById('login-overlay').classList.add('hidden');
}

document.getElementById('login-btn').addEventListener('click', doLogin);
document.getElementById('login-password').addEventListener('keydown', e => {
  if (e.key === 'Enter') doLogin();
});

async function doLogin() {
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  document.getElementById('login-error').textContent = '';

  try {
    const resp = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username, password }),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      document.getElementById('login-error').textContent = err.detail || 'Login failed';
      return;
    }
    const data = await resp.json();
    saveSession(data.access_token, data.user);
    document.getElementById('login-password').value = '';
    hideLogin();
    await initApp();
  } catch (e) {
    document.getElementById('login-error').textContent = 'Network error';
  }
}

document.getElementById('logout-btn').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  showLogin();
  renderConversations([]);
  clearChatArea();
});

/* ── Initialise app ─────────────────────────────────────────────────────────*/

async function initApp() {
  document.getElementById('user-label').textContent = currentUser.username;

  // Check if admin — show link
  if (currentUser.role === 'admin') {
    const footer = document.getElementById('sidebar-footer');
    if (!document.getElementById('admin-link')) {
      const a = document.createElement('a');
      a.id = 'admin-link';
      a.href = '/admin/';
      a.target = '_blank';
      a.style.cssText = 'display:block;margin-bottom:.3rem;color:#e94560;font-size:.8rem;text-decoration:none';
      a.textContent = '⚙ Admin Panel';
      footer.prepend(a);
    }
  }

  await loadModels();
  await loadConversations();
}

/* ── Models ──────────────────────────────────────────────────────────────── */

async function loadModels() {
  try {
    const resp = await apiFetch('/api/chat/models');
    if (!resp.ok) return;
    const data = await resp.json();
    const sel = document.getElementById('model-select');
    sel.innerHTML = '<option value="">Default</option>';
    for (const m of data.models) {
      const opt = document.createElement('option');
      opt.value = m;
      opt.textContent = m;
      sel.appendChild(opt);
    }
  } catch (_) {}
}

/* ── Conversations ────────────────────────────────────────────────────────── */

async function loadConversations() {
  try {
    const resp = await apiFetch('/api/chat/conversations');
    if (!resp.ok) return;
    conversations = await resp.json();
    renderConversations(conversations);
  } catch (_) {}
}

function renderConversations(convos) {
  const list = document.getElementById('conv-list');
  list.innerHTML = '';
  for (const c of convos) {
    const el = document.createElement('div');
    el.className = 'conv-item' + (c.id === currentConvId ? ' active' : '');
    el.dataset.id = c.id;

    const title = document.createElement('span');
    title.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1';
    title.textContent = c.title;

    const del = document.createElement('button');
    del.className = 'del-btn';
    del.title = 'Delete';
    del.textContent = '✕';
    del.addEventListener('click', async e => {
      e.stopPropagation();
      if (!confirm('Delete this conversation?')) return;
      await apiFetch(`/api/chat/conversations/${c.id}`, { method: 'DELETE' });
      if (currentConvId === c.id) { currentConvId = null; clearChatArea(); }
      await loadConversations();
    });

    el.appendChild(title);
    el.appendChild(del);
    el.addEventListener('click', () => openConversation(c.id));
    list.appendChild(el);
  }
}

document.getElementById('new-chat-btn').addEventListener('click', async () => {
  const resp = await apiFetch('/api/chat/conversations', {
    method: 'POST',
    body: JSON.stringify({ title: 'New Chat' }),
  });
  if (!resp.ok) return;
  const conv = await resp.json();
  conversations.unshift(conv);
  renderConversations(conversations);
  openConversation(conv.id, []);
});

async function openConversation(id, preloadedMessages) {
  currentConvId = id;
  document.querySelectorAll('.conv-item').forEach(el => {
    el.classList.toggle('active', Number(el.dataset.id) === id);
  });

  let messages = preloadedMessages;
  if (!messages) {
    const resp = await apiFetch(`/api/chat/conversations/${id}/messages`);
    messages = resp.ok ? await resp.json() : [];
  }

  clearChatArea();
  for (const m of messages) appendMessage(m.role, m.content, m.rag_used);

  document.getElementById('send-btn').disabled = false;
  document.getElementById('msg-input').focus();
  scrollToBottom();
}

/* ── Chat area ────────────────────────────────────────────────────────────── */

function clearChatArea() {
  const area = document.getElementById('chat-area');
  area.innerHTML = '';
  if (!currentConvId) {
    area.innerHTML = '<div id="empty-state">Select a conversation or start a new chat.</div>';
    document.getElementById('send-btn').disabled = true;
  }
}

function appendMessage(role, content, ragUsed = false) {
  const area = document.getElementById('chat-area');
  const empty = document.getElementById('empty-state');
  if (empty) empty.remove();

  const el = document.createElement('div');
  el.className = `message ${role}`;
  el.innerHTML = renderMarkdown(content);

  if (ragUsed && role === 'assistant') {
    const badge = document.createElement('div');
    badge.className = 'rag-badge';
    badge.textContent = '📄 answered using document context';
    el.appendChild(badge);
  }
  area.appendChild(el);
  return el;
}

function scrollToBottom() {
  const area = document.getElementById('chat-area');
  area.scrollTop = area.scrollHeight;
}

/* ── Send message ────────────────────────────────────────────────────────── */

document.getElementById('send-btn').addEventListener('click', sendMessage);
document.getElementById('msg-input').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

document.getElementById('msg-input').addEventListener('input', function () {
  this.style.height = 'auto';
  this.style.height = Math.min(this.scrollHeight, 180) + 'px';
});

async function sendMessage() {
  if (!currentConvId || streaming) return;
  const input = document.getElementById('msg-input');
  const text = input.value.trim();
  if (!text) return;

  const useRag = document.getElementById('rag-toggle').checked;
  const model = document.getElementById('model-select').value;

  input.value = '';
  input.style.height = 'auto';
  appendMessage('user', text);
  scrollToBottom();

  const asstEl = document.createElement('div');
  asstEl.className = 'message assistant';
  const cursor = document.createElement('span');
  cursor.className = 'cursor';
  asstEl.appendChild(cursor);
  document.getElementById('chat-area').appendChild(asstEl);
  scrollToBottom();

  streaming = true;
  document.getElementById('send-btn').disabled = true;

  const params = new URLSearchParams({ conversation_id: currentConvId, content: text, use_rag: useRag });
  if (model) params.set('model', model);

  let accumulated = '';
  let ragUsed = false;

  try {
    const resp = await fetch(`/api/chat/stream?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!resp.ok) {
      asstEl.textContent = 'Error: could not reach server.';
      return;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = JSON.parse(line.slice(6));
        if (payload.error) {
          asstEl.textContent = `Error: ${payload.error}`;
          break;
        }
        if (payload.delta) {
          accumulated += payload.delta;
          cursor.remove();
          asstEl.innerHTML = renderMarkdown(accumulated);
          asstEl.appendChild(cursor);
          scrollToBottom();
        }
        if (payload.done) {
          cursor.remove();
          asstEl.innerHTML = renderMarkdown(accumulated);
          if (ragUsed) {
            const badge = document.createElement('div');
            badge.className = 'rag-badge';
            badge.textContent = '📄 answered using document context';
            asstEl.appendChild(badge);
          }
          // Refresh conversation list (title may have updated)
          await loadConversations();
        }
      }
    }
  } catch (e) {
    asstEl.textContent = 'Connection error. Is the server running?';
  } finally {
    cursor.remove();
    streaming = false;
    document.getElementById('send-btn').disabled = false;
    document.getElementById('msg-input').focus();
    scrollToBottom();
  }
}

/* ── Minimal Markdown renderer ───────────────────────────────────────────── */

function renderMarkdown(text) {
  // Escape HTML first
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Code blocks
  html = html.replace(/```[\w]*\n?([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  // Bold
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Italic
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  // Newlines
  html = html.replace(/\n/g, '<br>');

  return html;
}

/* ── Boot ────────────────────────────────────────────────────────────────── */

(async function boot() {
  token = localStorage.getItem('llm_token');
  const stored = localStorage.getItem('llm_user');
  if (token && stored) {
    try {
      currentUser = JSON.parse(stored);
      // Verify token is still valid
      const resp = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (resp.ok) {
        currentUser = await resp.json();
        hideLogin();
        await initApp();
        return;
      }
    } catch (_) {}
  }
  showLogin();
})();
