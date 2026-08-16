// Google Calendar wrapper: reading events, creating/updating/deleting events,
// and detecting overlapping-time conflicts.
const { google } = require('googleapis');
const { getAuthenticatedClient } = require('./googleAuth');
const { getUser } = require('../db/db');

async function getCalendarClient() {
  const auth = await getAuthenticatedClient();
  return google.calendar({ version: 'v3', auth });
}

function friendlyError(err, fallback) {
  const message = err?.response?.data?.error?.message || err.message || fallback;
  const wrapped = new Error(message);
  wrapped.original = err;
  return wrapped;
}

/** Lists events between two ISO datetimes, normalized to a simple shape. */
async function listEvents(timeMin, timeMax) {
  try {
    const calendar = await getCalendarClient();
    const { data } = await calendar.events.list({
      calendarId: 'primary',
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 250,
    });
    return (data.items || []).map(normalizeEvent);
  } catch (err) {
    if (err.code === 'GOOGLE_NOT_CONNECTED') throw err;
    throw friendlyError(err, 'Failed to load calendar events.');
  }
}

function normalizeEvent(event) {
  const start = event.start?.dateTime || event.start?.date;
  const end = event.end?.dateTime || event.end?.date;
  const allDay = !event.start?.dateTime;
  let category = 'personal';
  const summary = event.summary || '(No title)';
  if (summary.startsWith('🏢')) category = 'work';
  else if (summary.startsWith('📚') || summary.startsWith('📝')) category = 'school';

  return {
    id: event.id,
    title: summary,
    description: event.description || '',
    location: event.location || '',
    start,
    end,
    allDay,
    category,
    htmlLink: event.htmlLink,
  };
}

async function getTodayEvents(timezone) {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  return listEvents(start.toISOString(), end.toISOString());
}

async function getWeekEvents() {
  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() - now.getDay()); // Sunday
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 7);
  return listEvents(start.toISOString(), end.toISOString());
}

async function createEvent({ title, description, location, start, end, allDay, reminders }) {
  try {
    const calendar = await getCalendarClient();
    const eventBody = {
      summary: title,
      description,
      location,
    };
    if (allDay) {
      eventBody.start = { date: start.slice(0, 10) };
      eventBody.end = { date: end.slice(0, 10) };
    } else {
      const user = getUser();
      eventBody.start = { dateTime: start, timeZone: user.timezone || 'America/New_York' };
      eventBody.end = { dateTime: end, timeZone: user.timezone || 'America/New_York' };
    }
    if (reminders && reminders.length) {
      eventBody.reminders = {
        useDefault: false,
        overrides: reminders, // [{ method: 'popup', minutes: 4320 }, ...]
      };
    }
    const { data } = await calendar.events.insert({ calendarId: 'primary', requestBody: eventBody });
    return normalizeEvent(data);
  } catch (err) {
    if (err.code === 'GOOGLE_NOT_CONNECTED') throw err;
    throw friendlyError(err, 'Failed to create calendar event.');
  }
}

async function updateEvent(eventId, patch) {
  try {
    const calendar = await getCalendarClient();
    const requestBody = {};
    if (patch.title) requestBody.summary = patch.title;
    if (patch.description !== undefined) requestBody.description = patch.description;
    if (patch.location !== undefined) requestBody.location = patch.location;
    if (patch.start) {
      requestBody.start = patch.allDay
        ? { date: patch.start.slice(0, 10) }
        : { dateTime: patch.start, timeZone: getUser().timezone || 'America/New_York' };
    }
    if (patch.end) {
      requestBody.end = patch.allDay
        ? { date: patch.end.slice(0, 10) }
        : { dateTime: patch.end, timeZone: getUser().timezone || 'America/New_York' };
    }
    const { data } = await calendar.events.patch({
      calendarId: 'primary',
      eventId,
      requestBody,
    });
    return normalizeEvent(data);
  } catch (err) {
    if (err.code === 'GOOGLE_NOT_CONNECTED') throw err;
    throw friendlyError(err, 'Failed to update calendar event.');
  }
}

async function deleteEvent(eventId) {
  try {
    const calendar = await getCalendarClient();
    await calendar.events.delete({ calendarId: 'primary', eventId });
    return true;
  } catch (err) {
    if (err.code === 'GOOGLE_NOT_CONNECTED') throw err;
    if (err?.response?.status === 410 || err?.response?.status === 404) return true; // already gone
    throw friendlyError(err, 'Failed to delete calendar event.');
  }
}

/** Returns pairs of events whose [start, end) ranges overlap (all-day events are excluded). */
function findConflicts(events) {
  const timed = events
    .filter((e) => !e.allDay)
    .map((e) => ({ ...e, startMs: new Date(e.start).getTime(), endMs: new Date(e.end).getTime() }))
    .sort((a, b) => a.startMs - b.startMs);

  const conflicts = [];
  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length; j++) {
      if (timed[j].startMs >= timed[i].endMs) break; // sorted by start, no further overlap possible
      conflicts.push({ eventA: timed[i], eventB: timed[j] });
    }
  }
  return conflicts;
}

/** Checks whether a candidate [start, end) window overlaps any existing event. */
function hasConflict(events, start, end) {
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  return events
    .filter((ev) => !ev.allDay)
    .some((ev) => {
      const evS = new Date(ev.start).getTime();
      const evE = new Date(ev.end).getTime();
      return s < evE && evS < e;
    });
}

module.exports = {
  listEvents,
  getTodayEvents,
  getWeekEvents,
  createEvent,
  updateEvent,
  deleteEvent,
  findConflicts,
  hasConflict,
  normalizeEvent,
};
