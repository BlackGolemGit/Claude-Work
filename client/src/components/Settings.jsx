import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'Europe/London',
  'Europe/Paris',
  'Asia/Tokyo',
  'Australia/Sydney',
  'UTC',
];

export default function Settings() {
  const [settings, setSettings] = useState(null);
  const [twilioSid, setTwilioSid] = useState('');
  const [twilioToken, setTwilioToken] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .get('/settings')
      .then((data) => setSettings(data.settings))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  function update(field, value) {
    setSettings((prev) => ({ ...prev, [field]: value }));
  }

  async function save() {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const payload = { ...settings };
      if (twilioSid) payload.twilio_account_sid = twilioSid;
      if (twilioToken) payload.twilio_auth_token = twilioToken;
      const data = await api.put('/settings', payload);
      setSettings(data.settings);
      setTwilioSid('');
      setTwilioToken('');
      setMessage('Settings saved.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function connectGoogle() {
    try {
      const { url } = await api.get('/settings/google/auth-url');
      window.location.href = url;
    } catch (err) {
      setError(err.message);
    }
  }

  async function disconnectGoogle() {
    try {
      await api.post('/settings/google/disconnect');
      const data = await api.get('/settings');
      setSettings(data.settings);
    } catch (err) {
      setError(err.message);
    }
  }

  async function sendTest() {
    setError(null);
    setMessage(null);
    try {
      const res = await api.post('/notifications/test');
      setMessage(`Test sent — ${JSON.stringify(res.results)}`);
    } catch (err) {
      setError(err.message);
    }
  }

  if (loading) return <p className="text-slate-500">Loading settings…</p>;
  if (!settings) return null;

  return (
    <div className="space-y-8 max-w-2xl">
      <h2 className="text-2xl font-bold text-slate-800">Settings</h2>

      {message && <div className="bg-green-50 border border-green-200 text-green-700 text-sm rounded-lg p-3">{message}</div>}
      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{error}</div>}

      <Section title="Profile">
        <Field label="Name">
          <input className="input" value={settings.name || ''} onChange={(e) => update('name', e.target.value)} />
        </Field>
        <Field label="Email (used for morning briefings & weekly previews)">
          <input className="input" type="email" value={settings.email || ''} onChange={(e) => update('email', e.target.value)} />
        </Field>
        <Field label="Timezone">
          <select className="input" value={settings.timezone} onChange={(e) => update('timezone', e.target.value)}>
            {TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>{tz}</option>
            ))}
          </select>
        </Field>
      </Section>

      <Section title="Notifications">
        <Field label="Morning briefing time">
          <input className="input" type="time" value={settings.morning_brief_time} onChange={(e) => update('morning_brief_time', e.target.value)} />
        </Field>
        <Field label="Weekly preview time (Sundays)">
          <input className="input" type="time" value={settings.weekly_preview_time} onChange={(e) => update('weekly_preview_time', e.target.value)} />
        </Field>
        <Field label="Notification preference">
          <select
            className="input"
            value={settings.notification_preference}
            onChange={(e) => update('notification_preference', e.target.value)}
          >
            <option value="email">Email</option>
            <option value="sms">SMS</option>
            <option value="both">Both</option>
          </select>
        </Field>
        <Field label={`Minimum daily free time buffer: ${settings.free_time_buffer_hours}h`}>
          <input
            className="w-full"
            type="range"
            min="1"
            max="6"
            step="1"
            value={settings.free_time_buffer_hours}
            onChange={(e) => update('free_time_buffer_hours', Number(e.target.value))}
          />
        </Field>
        <button onClick={sendTest} className="text-sm text-blue-600 hover:underline">Send a test notification</button>
      </Section>

      <Section title="Google Account">
        {settings.google_connected ? (
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-600">Connected as <span className="font-medium">{settings.google_email}</span></p>
            <button onClick={disconnectGoogle} className="text-sm font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-lg">
              Disconnect
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-600">Connect your Google account to enable Calendar &amp; Gmail features.</p>
            <button onClick={connectGoogle} className="text-sm font-medium bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg">
              Connect Google
            </button>
          </div>
        )}
      </Section>

      <Section title="Twilio (SMS)">
        <Field label="Your phone number (receives SMS)">
          <input className="input" value={settings.twilio_phone || ''} onChange={(e) => update('twilio_phone', e.target.value)} placeholder="+15551234567" />
        </Field>
        <Field label="Account SID">
          <input
            className="input"
            value={twilioSid}
            onChange={(e) => setTwilioSid(e.target.value)}
            placeholder={settings.twilio_configured ? '•••••••••••••••••••• (saved — enter to replace)' : 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'}
          />
        </Field>
        <Field label="Auth Token">
          <input
            className="input"
            type="password"
            value={twilioToken}
            onChange={(e) => setTwilioToken(e.target.value)}
            placeholder={settings.twilio_configured ? '•••••••••••••••••••• (saved — enter to replace)' : 'your auth token'}
          />
        </Field>
        <Field label="From number">
          <input className="input" value={settings.twilio_from_number || ''} onChange={(e) => update('twilio_from_number', e.target.value)} placeholder="+15559876543" />
        </Field>
      </Section>

      <Section title="School Email Watching">
        <Field label="School email domains (comma-separated)">
          <input
            className="input"
            value={settings.school_email_domains || ''}
            onChange={(e) => update('school_email_domains', e.target.value)}
            placeholder="myschool.instructure.com, professor@university.edu"
          />
        </Field>
        <Field label="Keywords (comma-separated)">
          <input
            className="input"
            value={settings.school_keywords || ''}
            onChange={(e) => update('school_keywords', e.target.value)}
            placeholder="assignment, homework, due, exam, quiz"
          />
        </Field>
      </Section>

      <div className="pb-8">
        <button
          onClick={save}
          disabled={saving}
          className="bg-slate-800 hover:bg-slate-900 disabled:opacity-50 text-white font-medium px-6 py-2.5 rounded-lg"
        >
          {saving ? 'Saving…' : 'Save Settings'}
        </button>
      </div>

      <style>{`.input { width: 100%; border: 1px solid #cbd5e1; border-radius: 0.5rem; padding: 0.5rem 0.75rem; font-size: 0.875rem; }`}</style>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
      <h3 className="font-semibold text-slate-700">{title}</h3>
      {children}
    </section>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-slate-500 mb-1">{label}</span>
      {children}
    </label>
  );
}
