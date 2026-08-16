# AI-Powered Personal Scheduling Agent

A full-stack personal scheduling assistant that watches your Gmail and Google Calendar,
syncs your work shifts and school deadlines automatically, detects RSVP invitations and
calendar conflicts, and delivers AI-written morning briefings and weekly previews by
email and/or SMS — plus a natural-language chat interface that can actually take
actions on your schedule.

## Features

1. **Daily Morning Briefing** — Claude writes a short, friendly summary of your day (calendar, tasks, shifts, RSVPs) delivered by email/SMS at a time you choose.
2. **RSVP Detection & Management** — polls Gmail every 30 minutes for invitations, lets you Accept/Decline from the dashboard, auto-replies to the organizer, and updates Google Calendar (with conflict warnings).
3. **HotSchedules Sync** — parses HotSchedules shift-notification emails with Claude and syncs them into Google Calendar as hard-blocked "🏢 Work Shift" events. Runs daily, plus a manual "Sync Now" button.
4. **School & Homework Tracking** — hourly Gmail scan for Canvas/Blackboard/Classroom/professor emails (domains & keywords you configure), extracts assignments/exams with Claude, adds them to Calendar with 3-day/1-day/day-of reminders.
5. **Life Balance Engine** — after every calendar sync, Claude looks at your free time and pending work and suggests how to use it, shown as dismissible cards.
6. **Conflict Detection** — flags overlapping events with a red banner and a one-click Claude-suggested fix.
7. **Weekly Preview** — a Sunday-evening AI-written preview of the week ahead, delivered by email/SMS.
8. **Chat Interface** — natural-language chat with full schedule context; Claude can actually schedule/move/delete events, mark homework complete, or look up your next shift, streamed token-by-token.

## Tech Stack

- **Frontend:** React (Vite) + Tailwind CSS + react-big-calendar
- **Backend:** Node.js + Express
- **AI:** Anthropic Claude API
- **Integrations:** Google Calendar API, Gmail API (OAuth 2.0), Twilio SMS
- **Database:** SQLite via better-sqlite3
- **Scheduler:** node-cron

## Project Structure

```
/project-root
  /client            React SPA (Vite + Tailwind)
  /server
    /routes          Express route handlers
    /jobs            node-cron jobs (briefing, preview, Gmail pollers, HotSchedules sync)
    /services        Claude, Google OAuth, Calendar, Gmail, Twilio, Encryption
    /db              schema.sql + db.js (better-sqlite3)
    index.js         App entrypoint + cron scheduling
  package.json        Root convenience scripts
```

---

## 1. Prerequisites

- Node.js 18+ and npm
- A Google account (for Calendar + Gmail)
- An [Anthropic API key](https://console.anthropic.com/)
- (Optional, for SMS) A [Twilio](https://www.twilio.com/) account

---

## 2. Create a Google Cloud project and enable the APIs

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
   - Under **Test users** (while the app is in "Testing" publishing status), add your own Google account email — otherwise Google will block the OAuth login.
4. In **APIs & Services → Credentials**:
   - Click **Create Credentials → OAuth client ID**.
   - Application type: **Web application**.
   - Under **Authorized redirect URIs**, add:
     ```
     http://localhost:3001/api/settings/google/callback
     ```
   - Save, then copy the **Client ID** and **Client Secret** — you'll need these for `.env`.

> **Note:** While your OAuth consent screen is in "Testing" mode, tokens can expire after 7 days and only test users can authenticate. For personal, indefinite use, you can leave it in Testing and just re-connect via Settings when needed, or submit it for verification if you want it fully published.

---

## 3. Set up Twilio (optional, for SMS notifications)

1. Create a free account at [twilio.com](https://www.twilio.com/try-twilio).
2. From the Twilio Console dashboard, copy your **Account SID** and **Auth Token**.
3. Buy or use a trial Twilio phone number (**Phone Numbers → Manage → Buy a number**) — this is your **From number**.
4. If you're on a trial account, verify the phone number you want to receive texts at (**Phone Numbers → Manage → Verified Caller IDs**).

You'll enter these three values (Account SID, Auth Token, From number) either in the app's **Settings** tab (recommended — they're encrypted at rest) or as fallback environment variables.

---

## 4. Get an Anthropic API key

1. Go to [console.anthropic.com](https://console.anthropic.com/) and create an API key.
2. Copy it for the `.env` file below.

---

## 5. Configure environment variables

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

This key encrypts (AES-256-GCM) your Google OAuth tokens and Twilio credentials at rest in SQLite — keep it secret and don't commit `.env` to git.

---

## 6. Install & run

From the project root:

```bash
npm run install:all
npm run dev
```

This starts:
- the Express API on **http://localhost:3001**
- the Vite dev server on **http://localhost:5173**

Open **http://localhost:5173**, go to **Settings**, and click **Connect Google** to authorize Calendar + Gmail access. Then fill in your email, notification preferences, Twilio details (if using SMS), and school email domains/keywords.

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

## 7. How the automated jobs work

| Job | Schedule | What it does |
|---|---|---|
| RSVP poller | every 30 minutes | Scans Gmail for invitation-shaped emails, extracts details with Claude, stores pending RSVPs |
| School poller | every hour | Scans your configured domains/keywords for assignment/exam emails, adds tasks + calendar reminders |
| HotSchedules sync | daily at 6:00am (+ manual "Sync Now") | Parses shift emails, creates "🏢 Work Shift" calendar events |
| Morning briefing | daily, at your configured time | Claude-written summary delivered by email/SMS |
| Weekly preview | Sundays, at your configured time | Claude-written week-ahead summary delivered by email/SMS |

All Google API calls automatically refresh the access token from the stored refresh token — you should only need to reconnect if you explicitly disconnect, revoke access in your Google Account, or the refresh token itself is revoked (e.g. by Google after prolonged inactivity while the OAuth app is in Testing mode).

---

## 8. Troubleshooting

- **"Google account is not connected"** errors: go to Settings → Connect Google.
- **OAuth screen says the app is blocked / not verified**: make sure your Google account is added as a Test User on the OAuth consent screen (Testing publishing status only allows test users).
- **SMS not sending**: confirm your Twilio Account SID/Auth Token/From number are saved in Settings (or `.env`), and that your "Your phone number" field is a verified number if your Twilio account is still a trial.
- **No RSVPs/school tasks/shifts appearing**: use the manual "Sync Now" / "Scan Gmail Now" buttons on the Dashboard, School, and HotSchedules-related UI to trigger an immediate scan and see errors directly, and check the server console log for the underlying error.
- The app never crashes on an API error — every route catches errors and returns a friendly message shown in the UI.

---

## 9. Database

SQLite database file lives at `server/db/scheduler.sqlite` (auto-created on first run from `server/db/schema.sql`). Tables: `users`, `school_tasks`, `work_shifts`, `rsvps`, `suggestions`, `conversation_history`, plus internal `processed_emails` (dedupe tracking) and `sync_log` (last-synced timestamps).

This is a **single-user personal app** — the `users` table always has exactly one row (`id = 1`).
