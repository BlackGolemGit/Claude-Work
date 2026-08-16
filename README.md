# AI-Powered Personal Scheduling Agent

A full-stack personal scheduling assistant that watches your inboxes and Google Calendar,
syncs your work shifts and school deadlines automatically, detects RSVP invitations and
calendar conflicts, and delivers AI-written morning briefings and weekly previews by
email and/or SMS — plus a natural-language (and voice) chat interface that can actually
take actions on your schedule, and a long-term memory of what it's learned about you.

## Features

1. **Daily Morning Briefing** — Claude writes a short, friendly summary of your day (calendar, tasks, shifts, RSVPs) delivered by email/SMS at a time you choose.
2. **RSVP Detection & Management** — polls every connected inbox every 30 minutes for invitations, lets you Accept/Decline from the dashboard, auto-replies to the organizer, and updates Google Calendar (with conflict warnings).
3. **HotSchedules Sync** — parses HotSchedules shift-notification emails with Claude and syncs them into Google Calendar as hard-blocked "🏢 Work Shift" events. Runs daily, plus a manual "Sync Now" button.
4. **School & Homework Tracking** — hourly scan for Canvas/Blackboard/Classroom/professor emails (domains & keywords you configure), extracts assignments/exams with Claude, adds them to Calendar with 3-day/1-day/day-of reminders.
5. **Life Balance Engine** — after every calendar sync, Claude looks at your free time and pending work and suggests how to use it, shown as dismissible cards.
6. **Conflict Detection** — flags overlapping events with a red banner and a one-click Claude-suggested fix.
7. **Weekly Preview** — a Sunday-evening AI-written preview of the week ahead, delivered by email/SMS.
8. **Chat Interface** — natural-language (typed or spoken) chat with full schedule context; Claude can actually schedule/move/delete events, mark homework complete, look up your next shift, or save something to memory — streamed token-by-token.
9. **Multi-account inboxes** — connect any number of Google accounts (personal, work, school) plus generic IMAP/SMTP accounts (Outlook, Yahoo, school-hosted email, etc.) via app-password. Every active account is scanned for RSVPs, school emails, and shifts; one Google account is designated the Calendar account.
10. **Voice** — speak to the agent (Web Speech API mic input) and have it speak back: a "🔊 Speak My Day" button reads a spoken recap of today plus any clarifying questions Claude has for you, and chat replies can optionally be read aloud.
11. **Personal Memory** — a durable, editable store of facts/preferences/routines/people/goals the agent has learned about you (via the Memory tab, or automatically during chat), woven into every briefing, suggestion, and chat response so it keeps getting more personalized.

## Tech Stack

- **Frontend:** React (Vite) + Tailwind CSS + react-big-calendar + native Web Speech API
- **Backend:** Node.js + Express
- **AI:** Anthropic Claude API
- **Integrations:** Google Calendar API, Gmail API (OAuth 2.0), generic IMAP/SMTP (imapflow + nodemailer), Twilio SMS
- **Database:** SQLite via better-sqlite3
- **Scheduler:** node-cron
- **Testing:** Node's built-in test runner (`node:test`) + supertest for HTTP routes, autocannon for load testing

## Project Structure

```
/project-root
  /client            React SPA (Vite + Tailwind)
    /src
      /components    Dashboard, CalendarView, SchoolTasks, Chat, Memory, Settings, AccountsManager, ...
      voice.js        Web Speech API wrapper (mic input + spoken output)
  /server
    /routes          Express route handlers (calendar, gmail, hotschedules, school, chat, settings, notifications, memory)
    /jobs            node-cron jobs (briefing, preview, Gmail/IMAP pollers, HotSchedules sync)
    /services        Claude, Google OAuth, generic email account abstraction, Gmail, IMAP, Calendar, Twilio, Encryption
    /db              schema.sql + db.js (better-sqlite3)
    /test            node:test unit + HTTP route tests
    /scripts         loadtest.js (autocannon-based concurrency/stress test)
    index.js         App entrypoint + cron scheduling
  package.json        Root convenience scripts
```

---

## 1. Prerequisites

- Node.js 18+ and npm
- A Google account (for Calendar; Gmail optional if you'd rather use IMAP accounts only)
- An [Anthropic API key](https://console.anthropic.com/)
- (Optional, for SMS) A [Twilio](https://www.twilio.com/) account
- (Optional, for non-Google inboxes) An app-specific password from your email provider

---

## 2. Create a Google Cloud project and enable the APIs

At least one Google account is required for **Calendar** access (IMAP accounts have no calendar of their own). Gmail via this same OAuth app is also how RSVP/school/shift scanning works for Google-hosted inboxes.

1. Go to the [Google Cloud Console](https://console.cloud.google.com/) and create a new project (or select an existing one).
2. In **APIs & Services → Library**, search for and **Enable**:
   - **Google Calendar API**
   - **Gmail API**
3. In **APIs & Services → OAuth consent screen**:
   - Choose **External** (or **Internal** if you're on a Google Workspace org and only you will use it).
   - Fill in the app name (e.g. "AI Scheduling Agent"), your email as support contact, and developer contact.
   - Under **Scopes**, add:
     - `https://www.googleapis.com/auth/calendar`
     - `https://www.googleapis.com/auth/gmail.modify`
     - `https://www.googleapis.com/auth/gmail.send`
     - `https://www.googleapis.com/auth/userinfo.email`
     - `openid`
   - Under **Test users** (while the app is in "Testing" publishing status), add every Google account you plan to connect — otherwise Google will block the OAuth login for that account.
4. In **APIs & Services → Credentials**:
   - Click **Create Credentials → OAuth client ID**.
   - Application type: **Web application**.
   - Under **Authorized redirect URIs**, add:
     ```
     http://localhost:3001/api/settings/google/callback
     ```
   - Save, then copy the **Client ID** and **Client Secret** — you'll need these for `.env`.

> **Note:** While your OAuth consent screen is in "Testing" mode, tokens can expire after 7 days and only test users can authenticate. For personal, indefinite use, you can leave it in Testing and just re-connect via Settings when needed, or submit it for verification if you want it fully published.

You can connect **multiple** Google accounts from the Settings tab — each "Connect Google Account" click goes through this same flow and lets you pick a different account.

---

## 3. Connect non-Google inboxes (optional, IMAP/SMTP)

From **Settings → Connected Email Accounts → + Add Other Email (IMAP)**, you can add any inbox that supports IMAP:

- Use an **app-specific password**, not your normal login password, wherever the provider supports one (Outlook, Yahoo, iCloud, etc.) — this keeps your real password out of the app entirely.
- Common IMAP/SMTP hosts:
  | Provider | IMAP host | SMTP host |
  |---|---|---|
  | Outlook/Office365 | `outlook.office365.com` | `smtp.office365.com` |
  | Yahoo | `imap.mail.yahoo.com` | `smtp.mail.yahoo.com` |
  | iCloud | `imap.mail.me.com` | `smtp.mail.me.com` |
  | Most school Google Workspace accounts | connect as a Google account instead (step 2) | — |

IMAP accounts have no query language like Gmail's, so the agent instead pulls recent inbox messages and filters them locally for RSVP/school/HotSchedules candidates before sending anything to Claude. Use the account's **Test** button in Settings to verify IMAP+SMTP credentials work before relying on it.

---

## 4. Set up Twilio (optional, for SMS notifications)

1. Create a free account at [twilio.com](https://www.twilio.com/try-twilio).
2. From the Twilio Console dashboard, copy your **Account SID** and **Auth Token**.
3. Buy or use a trial Twilio phone number (**Phone Numbers → Manage → Buy a number**) — this is your **From number**.
4. If you're on a trial account, verify the phone number you want to receive texts at (**Phone Numbers → Manage → Verified Caller IDs**).

Enter these three values (Account SID, Auth Token, From number) in the app's **Settings** tab (recommended — they're encrypted at rest) or as fallback environment variables.

---

## 5. Get an Anthropic API key

1. Go to [console.anthropic.com](https://console.anthropic.com/) and create an API key.
2. Copy it for the `.env` file below.

---

## 6. Configure environment variables

```bash
cp server/.env.example server/.env
```

Edit `server/.env`:

```
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxxxxxxx
GOOGLE_REDIRECT_URI=http://localhost:3001/api/settings/google/callback
TWILIO_ACCOUNT_SID=ACxxxxxxxx        # optional — can also be set from Settings tab
TWILIO_AUTH_TOKEN=xxxxxxxx           # optional — can also be set from Settings tab
TWILIO_FROM_NUMBER=+15551234567      # optional — can also be set from Settings tab
ENCRYPTION_SECRET=some-long-random-string
PORT=3001
CLIENT_URL=http://localhost:5173
```

Generate a strong `ENCRYPTION_SECRET` with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

This key encrypts (AES-256-GCM) your Google OAuth tokens, IMAP/SMTP passwords, and Twilio credentials at rest in SQLite — keep it secret and don't commit `.env` to git. **Changing `ENCRYPTION_SECRET` after accounts are connected makes existing stored credentials undecryptable** — reconnect/re-enter them if you ever rotate it.

---

## 7. Install & run

From the project root:

```bash
npm run install:all
npm run dev
```

This starts:
- the Express API on **http://localhost:3001**
- the Vite dev server on **http://localhost:5173**

Open **http://localhost:5173**, go to **Settings**, and connect at least one Google account (for Calendar) plus any other inboxes you want watched. Then fill in your email, notification preferences, Twilio details (if using SMS), and school email domains/keywords.

To run each half individually:

```bash
npm run dev:server   # Express API only
npm run dev:client   # Vite dev server only
```

### Production build

```bash
npm run build:client       # builds client/dist
npm run start:server       # serves the built client + API from Express on PORT
```

---

## 8. Voice

Voice uses the browser's built-in **Web Speech API** — no extra API key, no per-use cost. It works in Chrome and Edge; support is inconsistent or missing in Firefox and Safari, in which case the mic button simply won't appear and spoken playback will show a friendly error instead of failing silently.

- **🎤 mic button** (Chat tab): speak a message; it's transcribed and sent automatically.
- **🔊 Speak replies** (Chat tab): toggle to have every Claude reply read aloud as it finishes streaming.
- **🔊 Speak My Day / 🌅 Speak My Day** (Dashboard and Chat tabs): asks Claude for a short spoken recap of today plus any clarifying questions it has, then speaks it aloud via `GET /api/chat/voice-recap`.

---

## 9. Memory

The **Memory** tab shows everything the agent has stored about you — preferences, facts, routines, people, and goals — each editable, pinnable, and deletable. You can add entries directly, and Claude also calls a `remember` tool during chat whenever you mention something durable (e.g. "I never want anything scheduled before 9am" or "my study partner is Sam"). Memory is included as context in the morning briefing, weekly preview, life-balance suggestions, and every chat message, so the agent's output keeps improving over time without you having to repeat yourself.

---

## 10. How the automated jobs work

| Job | Schedule | What it does |
|---|---|---|
| RSVP poller | every 30 minutes | Scans every connected account for invitation-shaped emails, extracts details with Claude, stores pending RSVPs |
| School poller | every hour | Scans your configured domains/keywords across every connected account for assignment/exam emails, adds tasks + calendar reminders |
| HotSchedules sync | daily at 6:00am (+ manual "Sync Now") | Parses shift emails from every connected account, creates "🏢 Work Shift" calendar events |
| Morning briefing | daily, at your configured time | Claude-written summary (using memory) delivered by email/SMS |
| Weekly preview | Sundays, at your configured time | Claude-written week-ahead summary (using memory) delivered by email/SMS |

All Google API calls automatically refresh the access token from the stored refresh token, per connected account — you should only need to reconnect an account if you explicitly disconnect it, revoke access in that Google Account, or its refresh token is revoked (e.g. by Google after prolonged inactivity while the OAuth app is in Testing mode).

---

## 11. Testing & stress testing

```bash
cd server
npm test          # unit + HTTP route tests (node:test + supertest) — runs against an isolated throwaway DB, ~2-3s
npm run loadtest   # concurrency/load test (autocannon) against the real Express app, ~15s per endpoint
```

`npm test` covers: AES encryption round-tripping, conflict-detection math, all `email_accounts`/`user_memory`/sync-log DB helpers, and HTTP-level checks that every route degrades to a friendly 4xx (never a 500 or crash) when Google/Twilio/Anthropic aren't configured — exactly the state a fresh install starts in.

`npm run loadtest` boots the real app against a throwaway SQLite DB and hammers 9 core endpoints with 50 concurrent connections for 15s each via [autocannon](https://github.com/mcollina/autocannon), reporting throughput, p50/p99 latency, and connection-level errors. It deliberately does **not** call live Google/Gmail/Twilio/Anthropic APIs — those are the user's real, rate-limited accounts, and hammering them at load-test volume risks tripping abuse detection or burning paid quota. What it verifies is that the server itself (routing, SQLite access, error handling) stays fast and never hangs/crashes under concurrent load, including on paths that hit an external-service error (e.g. `/api/calendar/today` with no Google account connected, which should 409 quickly and repeatedly, not degrade).

Neither command touches your real `server/db/scheduler.sqlite` — both use isolated `DB_PATH` overrides that are deleted when they finish.

---

## 12. Troubleshooting

- **"No Google account is connected"** errors: go to Settings → Connect Google Account, and make sure one account is marked "Calendar account".
- **OAuth screen says the app is blocked / not verified**: make sure the Google account you're connecting is added as a Test User on the OAuth consent screen (Testing publishing status only allows test users).
- **IMAP account "Test" fails**: double check host/port/TLS settings against your provider's docs, and confirm you're using an app-specific password, not your normal login password.
- **SMS not sending**: confirm your Twilio Account SID/Auth Token/From number are saved in Settings (or `.env`), and that your "Your phone number" field is a verified number if your Twilio account is still a trial.
- **No RSVPs/school tasks/shifts appearing**: use the manual "Sync Now" / "Scan Gmail Now" buttons on the Dashboard, School, and HotSchedules-related UI to trigger an immediate scan and see errors directly, and check the server console log for the underlying error.
- **Voice mic/speak buttons missing**: your browser doesn't support the Web Speech API for that direction (common on Firefox/Safari) — try Chrome or Edge.
- The app never crashes on an API error — every route catches errors and returns a friendly message shown in the UI (verified by the automated test suite above).

---

## 13. Database

SQLite database file lives at `server/db/scheduler.sqlite` (auto-created on first run from `server/db/schema.sql`). Tables: `users` (preferences only), `email_accounts` (every connected Google/IMAP inbox), `school_tasks`, `work_shifts`, `rsvps`, `suggestions`, `conversation_history`, `user_memory`, plus internal `processed_emails` (per-account dedupe tracking) and `sync_log` (last-synced timestamps).

This is a **single-user personal app** — the `users` table always has exactly one preferences row (`id = 1`), but it can hold any number of `email_accounts` rows.

A lightweight migration runs automatically on startup (`server/db/db.js`) for anyone upgrading from the earlier single-Google-account schema, moving existing credentials into `email_accounts` — no manual steps needed.
