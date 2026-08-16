import React, { useEffect, useState } from 'react';
import Dashboard from './components/Dashboard.jsx';
import CalendarView from './components/CalendarView.jsx';
import SchoolTasks from './components/SchoolTasks.jsx';
import Chat from './components/Chat.jsx';
import Settings from './components/Settings.jsx';

const TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: '🏠' },
  { id: 'calendar', label: 'Calendar', icon: '📅' },
  { id: 'school', label: 'School', icon: '📚' },
  { id: 'chat', label: 'Chat', icon: '💬' },
  { id: 'settings', label: 'Settings', icon: '⚙️' },
];

function initialTab() {
  const params = new URLSearchParams(window.location.search);
  const tab = params.get('tab');
  return TABS.some((t) => t.id === tab) ? tab : 'dashboard';
}

export default function App() {
  const [activeTab, setActiveTab] = useState(initialTab);
  const [menuOpen, setMenuOpen] = useState(false);
  const [googleBanner, setGoogleBanner] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const google = params.get('google');
    if (google === 'connected') setGoogleBanner({ type: 'success', text: 'Google account connected!' });
    if (google === 'error') setGoogleBanner({ type: 'error', text: 'Google connection failed. Please try again.' });
    if (google) {
      params.delete('google');
      const newUrl = `${window.location.pathname}${params.toString() ? `?${params}` : ''}`;
      window.history.replaceState({}, '', newUrl);
    }
  }, []);

  const selectTab = (id) => {
    setActiveTab(id);
    setMenuOpen(false);
  };

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-30 flex items-center justify-between bg-slate-900 text-white px-4 py-3">
        <span className="font-semibold">🗓️ Scheduling Agent</span>
        <button onClick={() => setMenuOpen((v) => !v)} className="text-xl" aria-label="Toggle menu">
          ☰
        </button>
      </div>

      {/* Sidebar */}
      <aside
        className={`bg-slate-900 text-slate-100 w-64 flex-shrink-0 flex-col fixed md:static top-0 left-0 h-full z-20 transition-transform duration-200
        ${menuOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0 flex`}
      >
        <div className="px-5 py-5 hidden md:block">
          <h1 className="text-lg font-bold">🗓️ Scheduling Agent</h1>
          <p className="text-xs text-slate-400 mt-1">Your AI-powered day, handled.</p>
        </div>
        <nav className="flex-1 px-3 mt-16 md:mt-2 space-y-1">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => selectTab(tab.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors
                ${activeTab === tab.id ? 'bg-blue-600 text-white' : 'text-slate-300 hover:bg-slate-800'}`}
            >
              <span>{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </nav>
        <div className="px-5 py-4 text-xs text-slate-500">Personal AI Scheduling Agent</div>
      </aside>

      {menuOpen && (
        <div className="fixed inset-0 bg-black/40 z-10 md:hidden" onClick={() => setMenuOpen(false)} />
      )}

      {/* Main content */}
      <main className="flex-1 overflow-y-auto pt-16 md:pt-0">
        {googleBanner && (
          <div
            className={`px-4 py-2 text-sm text-white flex items-center justify-between ${
              googleBanner.type === 'success' ? 'bg-green-600' : 'bg-red-600'
            }`}
          >
            <span>{googleBanner.text}</span>
            <button onClick={() => setGoogleBanner(null)} className="font-bold px-2">×</button>
          </div>
        )}
        <div className="p-4 md:p-8 max-w-6xl mx-auto">
          {activeTab === 'dashboard' && <Dashboard onNavigate={selectTab} />}
          {activeTab === 'calendar' && <CalendarView />}
          {activeTab === 'school' && <SchoolTasks />}
          {activeTab === 'chat' && <Chat />}
          {activeTab === 'settings' && <Settings />}
        </div>
      </main>
    </div>
  );
}
