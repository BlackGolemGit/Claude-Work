import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';

const emptyImapForm = {
  label: '', email: '',
  imapHost: '', imapPort: 993, imapSecure: true, imapUsername: '', imapPassword: '',
  sameAsImapForSmtp: false,
  smtpHost: '', smtpPort: 465, smtpSecure: true, smtpUsername: '', smtpPassword: '',
};

export default function AccountsManager() {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [message, setMessage] = useState(null);
  const [showImapForm, setShowImapForm] = useState(false);
  const [form, setForm] = useState(emptyImapForm);
  const [busyId, setBusyId] = useState(null);
  const [testResults, setTestResults] = useState({});

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await api.get('/settings/accounts');
      setAccounts(data.accounts);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function connectGoogle() {
    try {
      const { url } = await api.get('/settings/google/auth-url');
      window.location.href = url;
    } catch (err) {
      setError(err.message);
    }
  }

  async function setPrimary(id) {
    setBusyId(id);
    try {
      await api.post(`/settings/accounts/${id}/set-primary-calendar`);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function toggleActive(id) {
    setBusyId(id);
    try {
      await api.post(`/settings/accounts/${id}/toggle-active`);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function testConnection(id) {
    setBusyId(id);
    try {
      const result = await api.post(`/settings/accounts/${id}/test`);
      setTestResults((prev) => ({ ...prev, [id]: result }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id) {
    setBusyId(id);
    try {
      await api.delete(`/settings/accounts/${id}`);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function submitImap(e) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    try {
      await api.post('/settings/accounts/imap', {
        email: form.email,
        label: form.label || form.email,
        imap: {
          host: form.imapHost,
          port: Number(form.imapPort),
          secure: form.imapSecure,
          username: form.imapUsername,
          password: form.imapPassword,
        },
        smtp: form.sameAsImapForSmtp
          ? { host: form.imapHost, port: 587, secure: false, username: form.imapUsername, password: form.imapPassword }
          : {
              host: form.smtpHost,
              port: Number(form.smtpPort),
              secure: form.smtpSecure,
              username: form.smtpUsername || form.imapUsername,
              password: form.smtpPassword || form.imapPassword,
            },
      });
      setMessage('Account added. Use "Test Connection" to verify it can log in.');
      setForm(emptyImapForm);
      setShowImapForm(false);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="space-y-4">
      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{error}</div>}
      {message && <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg p-3">{message}</div>}

      {loading ? (
        <p className="text-sm text-slate-500">Loading accounts…</p>
      ) : accounts.length === 0 ? (
        <p className="text-sm text-slate-500">No email accounts connected yet.</p>
      ) : (
        <div className="space-y-2">
          {accounts.map((a) => (
            <div key={a.id} className="border border-slate-200 rounded-lg p-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <p className="text-sm font-medium text-slate-800">
                    {a.provider === 'google' ? '🔗' : '✉️'} {a.label}
                    {a.isCalendarPrimary && (
                      <span className="ml-2 text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">Calendar account</span>
                    )}
                    {!a.isActive && <span className="ml-2 text-xs bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full">Paused</span>}
                  </p>
                  <p className="text-xs text-slate-500">
                    {a.email} · {a.provider === 'google' ? 'Google (Calendar + Gmail)' : `IMAP (${a.imapHost || 'no host'})`}
                  </p>
                  {testResults[a.id] && (
                    <p className={`text-xs mt-1 ${testResults[a.id].status === 'ok' ? 'text-green-600' : 'text-red-600'}`}>
                      {testResults[a.id].status === 'ok' ? '✓ Connection OK' : `✗ ${JSON.stringify(testResults[a.id].detail || testResults[a.id].error)}`}
                    </p>
                  )}
                </div>
                <div className="flex gap-1.5 flex-wrap">
                  {a.provider === 'google' && !a.isCalendarPrimary && (
                    <SmallButton onClick={() => setPrimary(a.id)} busy={busyId === a.id}>Set as Calendar</SmallButton>
                  )}
                  <SmallButton onClick={() => testConnection(a.id)} busy={busyId === a.id}>Test</SmallButton>
                  <SmallButton onClick={() => toggleActive(a.id)} busy={busyId === a.id}>{a.isActive ? 'Pause' : 'Resume'}</SmallButton>
                  <SmallButton onClick={() => remove(a.id)} busy={busyId === a.id} danger>Remove</SmallButton>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2 flex-wrap pt-2">
        <button onClick={connectGoogle} className="text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg">
          + Connect Google Account
        </button>
        <button
          onClick={() => setShowImapForm((v) => !v)}
          className="text-sm font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-lg"
        >
          {showImapForm ? 'Cancel' : '+ Add Other Email (IMAP)'}
        </button>
      </div>

      {showImapForm && (
        <form onSubmit={submitImap} className="border border-slate-200 rounded-lg p-4 space-y-3 bg-slate-50">
          <p className="text-xs text-slate-500">
            Use an app-specific password, not your regular login password, for providers that support it (Outlook, Yahoo, etc).
          </p>
          <div className="grid sm:grid-cols-2 gap-3">
            <TextField label="Label" value={form.label} onChange={(v) => setForm((f) => ({ ...f, label: v }))} placeholder="Work Outlook" />
            <TextField label="Email address" value={form.email} onChange={(v) => setForm((f) => ({ ...f, email: v }))} placeholder="me@outlook.com" required />
          </div>
          <p className="text-xs font-semibold text-slate-600 pt-1">IMAP (read)</p>
          <div className="grid sm:grid-cols-2 gap-3">
            <TextField label="IMAP host" value={form.imapHost} onChange={(v) => setForm((f) => ({ ...f, imapHost: v }))} placeholder="outlook.office365.com" required />
            <TextField label="IMAP port" value={form.imapPort} onChange={(v) => setForm((f) => ({ ...f, imapPort: v }))} type="number" />
            <TextField label="Username" value={form.imapUsername} onChange={(v) => setForm((f) => ({ ...f, imapUsername: v }))} required />
            <TextField label="Password / app password" value={form.imapPassword} onChange={(v) => setForm((f) => ({ ...f, imapPassword: v }))} type="password" required />
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-500">
            <input type="checkbox" checked={form.imapSecure} onChange={(e) => setForm((f) => ({ ...f, imapSecure: e.target.checked }))} />
            Use TLS (recommended, port 993)
          </label>

          <p className="text-xs font-semibold text-slate-600 pt-1">SMTP (for sending RSVP replies)</p>
          <label className="flex items-center gap-2 text-xs text-slate-500">
            <input
              type="checkbox"
              checked={form.sameAsImapForSmtp}
              onChange={(e) => setForm((f) => ({ ...f, sameAsImapForSmtp: e.target.checked }))}
            />
            Same host/credentials as IMAP (common default)
          </label>
          {!form.sameAsImapForSmtp && (
            <div className="grid sm:grid-cols-2 gap-3">
              <TextField label="SMTP host" value={form.smtpHost} onChange={(v) => setForm((f) => ({ ...f, smtpHost: v }))} placeholder="smtp.office365.com" />
              <TextField label="SMTP port" value={form.smtpPort} onChange={(v) => setForm((f) => ({ ...f, smtpPort: v }))} type="number" />
              <TextField label="SMTP username" value={form.smtpUsername} onChange={(v) => setForm((f) => ({ ...f, smtpUsername: v }))} placeholder="defaults to IMAP username" />
              <TextField label="SMTP password" value={form.smtpPassword} onChange={(v) => setForm((f) => ({ ...f, smtpPassword: v }))} type="password" placeholder="defaults to IMAP password" />
            </div>
          )}

          <button type="submit" className="bg-slate-800 hover:bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-lg">
            Add Account
          </button>
        </form>
      )}
    </div>
  );
}

function SmallButton({ onClick, busy, danger, children }) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className={`text-xs font-medium px-2.5 py-1.5 rounded-lg disabled:opacity-50 ${
        danger ? 'bg-red-50 text-red-600 hover:bg-red-100' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
      }`}
    >
      {children}
    </button>
  );
}

function TextField({ label, value, onChange, type = 'text', placeholder, required }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-slate-500 mb-1">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm"
      />
    </label>
  );
}
