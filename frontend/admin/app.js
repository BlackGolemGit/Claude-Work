/* ── State ───────────────────────────────────────────────────────────────── */
let token = null;
let currentUser = null;
let editingUserId = null;
let statsInterval = null;
let pollTimers = {};

/* ── API ─────────────────────────────────────────────────────────────────── */

async function apiFetch(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...opts.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  let resp = await fetch(path, { ...opts, headers });

  if (resp.status === 401) {
    const r = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
    if (r.ok) {
      const data = await r.json();
      token = data.access_token;
      localStorage.setItem('admin_token', token);
      headers['Authorization'] = `Bearer ${token}`;
      resp = await fetch(path, { ...opts, headers });
    } else {
      showLogin();
      throw new Error('Session expired');
    }
  }
  return resp;
}

/* ── Auth ────────────────────────────────────────────────────────────────── */

function showLogin() {
  token = null; currentUser = null;
  localStorage.removeItem('admin_token');
  localStorage.removeItem('admin_user');
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
  if (data.user.role !== 'admin') {
    document.getElementById('login-error').textContent = 'Admin access required';
    return;
  }
  token = data.access_token;
  currentUser = data.user;
  localStorage.setItem('admin_token', token);
  localStorage.setItem('admin_user', JSON.stringify(currentUser));
  document.getElementById('login-password').value = '';
  hideLogin();
  initApp();
}

document.getElementById('topbar-logout').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  clearInterval(statsInterval);
  showLogin();
});

/* ── App init ────────────────────────────────────────────────────────────── */

function initApp() {
  document.getElementById('admin-user').textContent = currentUser.username;
  loadUsers();
  loadDocuments();
  loadStats();
  statsInterval = setInterval(loadStats, 30000);
}

/* ── Tabs ────────────────────────────────────────────────────────────────── */

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`panel-${tab.dataset.panel}`).classList.add('active');
    if (tab.dataset.panel === 'documents') loadDocuments();
    if (tab.dataset.panel === 'stats') loadStats();
  });
});

/* ── Users ───────────────────────────────────────────────────────────────── */

async function loadUsers() {
  const resp = await apiFetch('/api/admin/users');
  if (!resp.ok) return;
  const users = await resp.json();
  const tbody = document.getElementById('users-tbody');
  tbody.innerHTML = '';
  for (const u of users) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${esc(u.username)}</strong></td>
      <td>${esc(u.email)}</td>
      <td><span class="badge badge-${u.role}">${u.role}</span></td>
      <td><span class="badge badge-${u.is_active ? 'active' : 'inactive'}">${u.is_active ? 'Active' : 'Inactive'}</span></td>
      <td>${u.last_login ? fmtDate(u.last_login) : '—'}</td>
      <td>${fmtDate(u.created_at)}</td>
      <td>
        <button class="btn btn-secondary btn-sm" onclick="openEditUser(${u.id})">Edit</button>
        ${u.id !== currentUser.id
          ? `<button class="btn btn-danger btn-sm" onclick="deactivateUser(${u.id}, '${esc(u.username)}')">Deactivate</button>`
          : ''}
      </td>`;
    tbody.appendChild(tr);
  }
}

document.getElementById('create-user-btn').addEventListener('click', () => openUserModal(null));

function openUserModal(user) {
  editingUserId = user ? user.id : null;
  document.getElementById('modal-title').textContent = user ? 'Edit User' : 'Create User';
  document.getElementById('modal-username').value = user ? user.username : '';
  document.getElementById('modal-username').disabled = !!user;
  document.getElementById('modal-email').value = user ? user.email : '';
  document.getElementById('modal-password').value = '';
  document.getElementById('modal-pw-hint').style.display = user ? '' : 'none';
  document.getElementById('modal-role').value = user ? user.role : 'user';
  document.getElementById('modal-active').value = user ? String(user.is_active) : 'true';
  document.getElementById('modal-active').style.display = user ? '' : 'none';
  document.querySelector('[for="modal-active"], label[for="modal-active"]');
  document.getElementById('modal-error').textContent = '';
  document.getElementById('modal-error').classList.add('hidden');
  document.getElementById('user-modal').classList.remove('hidden');
}

async function openEditUser(id) {
  const resp = await apiFetch(`/api/admin/users/${id}`);
  if (!resp.ok) return;
  openUserModal(await resp.json());
}

async function deactivateUser(id, username) {
  if (!confirm(`Deactivate user "${username}"?`)) return;
  await apiFetch(`/api/admin/users/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ is_active: false }),
  });
  loadUsers();
}

document.getElementById('modal-cancel').addEventListener('click', () => {
  document.getElementById('user-modal').classList.add('hidden');
});

document.getElementById('modal-save').addEventListener('click', async () => {
  const errEl = document.getElementById('modal-error');
  errEl.textContent = '';
  errEl.classList.add('hidden');

  const body = {
    email: document.getElementById('modal-email').value.trim(),
    role: document.getElementById('modal-role').value,
  };

  if (!editingUserId) {
    body.username = document.getElementById('modal-username').value.trim();
    body.password = document.getElementById('modal-password').value;
    if (!body.username || !body.password) {
      errEl.textContent = 'Username and password are required';
      errEl.classList.remove('hidden');
      return;
    }
  } else {
    body.is_active = document.getElementById('modal-active').value === 'true';
    const pw = document.getElementById('modal-password').value;
    if (pw) body.password = pw;
  }

  const url = editingUserId ? `/api/admin/users/${editingUserId}` : '/api/admin/users';
  const method = editingUserId ? 'PATCH' : 'POST';
  const resp = await apiFetch(url, { method, body: JSON.stringify(body) });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    errEl.textContent = err.detail || 'Error saving user';
    errEl.classList.remove('hidden');
    return;
  }
  document.getElementById('user-modal').classList.add('hidden');
  loadUsers();
});

/* ── Documents ───────────────────────────────────────────────────────────── */

async function loadDocuments() {
  const resp = await apiFetch('/api/documents/');
  if (!resp.ok) return;
  const docs = await resp.json();
  renderDocs(docs);
}

function renderDocs(docs) {
  const tbody = document.getElementById('docs-tbody');
  tbody.innerHTML = '';
  for (const d of docs) {
    const tr = document.createElement('tr');
    tr.id = `doc-row-${d.id}`;
    tr.innerHTML = `
      <td title="${esc(d.original_name)}">${esc(truncate(d.original_name, 40))}</td>
      <td>${esc(d.mime_type)}</td>
      <td>${fmtSize(d.file_size)}</td>
      <td><span class="badge badge-${d.status}" id="doc-status-${d.id}">${d.status}</span></td>
      <td id="doc-chunks-${d.id}">${d.chunk_count}</td>
      <td>${fmtDate(d.created_at)}</td>
      <td>
        ${d.status === 'error' ? `<button class="btn btn-secondary btn-sm" onclick="reindexDoc(${d.id})">Retry</button> ` : ''}
        <button class="btn btn-danger btn-sm" onclick="deleteDoc(${d.id}, '${esc(d.original_name)}')">Delete</button>
      </td>`;
    tbody.appendChild(tr);
    if (d.status === 'pending' || d.status === 'processing') startPolling(d.id);
  }
}

async function deleteDoc(id, name) {
  if (!confirm(`Delete "${name}" and remove it from the knowledge base?`)) return;
  await apiFetch(`/api/documents/${id}`, { method: 'DELETE' });
  loadDocuments();
}

async function reindexDoc(id) {
  await apiFetch(`/api/admin/documents/reindex/${id}`, { method: 'POST' });
  startPolling(id);
  loadDocuments();
}

function startPolling(docId) {
  if (pollTimers[docId]) return;
  pollTimers[docId] = setInterval(async () => {
    const resp = await apiFetch(`/api/documents/${docId}/status`);
    if (!resp.ok) return;
    const s = await resp.json();
    const badge = document.getElementById(`doc-status-${docId}`);
    const chunks = document.getElementById(`doc-chunks-${docId}`);
    if (badge) {
      badge.textContent = s.status;
      badge.className = `badge badge-${s.status}`;
    }
    if (chunks) chunks.textContent = s.chunk_count;
    if (s.status === 'indexed' || s.status === 'error') {
      clearInterval(pollTimers[docId]);
      delete pollTimers[docId];
      loadDocuments();
    }
  }, 2000);
}

/* ── Upload ──────────────────────────────────────────────────────────────── */

const uploadZone = document.getElementById('upload-zone');
const fileInput = document.getElementById('file-input');

document.getElementById('browse-link').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => uploadFiles(fileInput.files));

uploadZone.addEventListener('dragover', e => { e.preventDefault(); uploadZone.classList.add('dragover'); });
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));
uploadZone.addEventListener('drop', e => {
  e.preventDefault();
  uploadZone.classList.remove('dragover');
  uploadFiles(e.dataTransfer.files);
});

async function uploadFiles(files) {
  if (!files || !files.length) return;
  const status = document.getElementById('upload-status');
  const bar = document.getElementById('upload-progress');

  for (const file of files) {
    status.textContent = `Uploading ${file.name}…`;
    bar.style.display = 'block';
    bar.value = 0;

    await new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/documents/upload');
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.upload.onprogress = e => { if (e.lengthComputable) bar.value = (e.loaded / e.total) * 100; };
      xhr.onload = () => { bar.value = 100; resolve(); };
      xhr.onerror = () => { status.textContent = `Error uploading ${file.name}`; resolve(); };
      const fd = new FormData();
      fd.append('file', file);
      xhr.send(fd);
    });

    status.textContent = `${file.name} queued for indexing`;
    bar.style.display = 'none';
    fileInput.value = '';
    await loadDocuments();
  }
}

/* ── Stats ───────────────────────────────────────────────────────────────── */

async function loadStats() {
  const resp = await apiFetch('/api/admin/stats');
  if (!resp.ok) return;
  const s = await resp.json();

  const dot = document.getElementById('ollama-dot');
  const statusText = document.getElementById('ollama-status-text');
  const ok = s.system.ollama_status === 'online';
  dot.className = `dot ${ok ? 'green' : 'red'}`;
  statusText.textContent = `Ollama: ${ok ? 'Online' : 'Offline'}`;

  const grid = document.getElementById('stats-grid');
  grid.innerHTML = '';

  const cards = [
    { label: 'Total Users', value: s.users.total, color: 'blue' },
    { label: 'Active Users', value: s.users.active, color: 'green' },
    { label: 'Admins', value: s.users.admins, color: 'yellow' },
    { label: 'Total Conversations', value: s.conversations.total, color: 'blue' },
    { label: 'Total Messages', value: s.messages.total, color: 'blue' },
    { label: 'Documents', value: s.documents.total, color: 'blue' },
    { label: 'Indexed Docs', value: s.documents.indexed, color: 'green' },
    { label: 'Doc Errors', value: s.documents.error, color: s.documents.error > 0 ? 'red' : 'blue' },
    { label: 'Vector Chunks', value: s.system.chroma_chunks, color: 'blue' },
    { label: 'Uptime', value: fmtUptime(s.system.uptime_seconds), color: 'green' },
    { label: 'Storage Used', value: fmtSize(s.documents.total_size_bytes), color: 'yellow' },
  ];

  for (const c of cards) {
    const el = document.createElement('div');
    el.className = `stat-card ${c.color}`;
    el.innerHTML = `<div class="label">${c.label}</div><div class="value">${c.value}</div>`;
    grid.appendChild(el);
  }

  document.getElementById('stats-updated').textContent = `Last updated: ${new Date().toLocaleTimeString()}`;
}

/* ── Utilities ───────────────────────────────────────────────────────────── */

function esc(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

function fmtSize(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
  return `${bytes.toFixed(1)} ${units[i]}`;
}

function fmtUptime(secs) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function truncate(str, len) {
  return str.length > len ? str.slice(0, len) + '…' : str;
}

/* ── Boot ────────────────────────────────────────────────────────────────── */

(async function boot() {
  token = localStorage.getItem('admin_token');
  const stored = localStorage.getItem('admin_user');
  if (token && stored) {
    try {
      const resp = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
      if (resp.ok) {
        currentUser = await resp.json();
        if (currentUser.role === 'admin') {
          hideLogin();
          initApp();
          return;
        }
      }
    } catch (_) {}
  }
  showLogin();
})();
