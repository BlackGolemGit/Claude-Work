// Central wrapper around the Anthropic Claude API. Provides both simple
// one-shot completions (used for briefs, parsing, and suggestions) and a raw
// streaming interface (used by the chat panel, including tool use).
const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
// The model id is configurable via env in case Anthropic renames/rotates it;
// defaults to the model requested for this project.
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

/** Extracts the first JSON object/array out of a Claude text response, tolerating markdown code fences. */
function extractJson(text) {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.search(/[[{]/);
  if (start === -1) return null;
  // Find the matching closing bracket by scanning balance, since Claude
  // occasionally adds trailing prose after the JSON block.
  const opener = candidate[start];
  const closer = opener === '{' ? '}' : ']';
  let depth = 0;
  for (let i = start; i < candidate.length; i++) {
    if (candidate[i] === opener) depth++;
    else if (candidate[i] === closer) {
      depth--;
      if (depth === 0) {
        const jsonStr = candidate.slice(start, i + 1);
        try {
          return JSON.parse(jsonStr);
        } catch (err) {
          console.error('[claude] Failed to parse extracted JSON:', err.message);
          return null;
        }
      }
    }
  }
  return null;
}

/** Non-streaming single completion. Returns the concatenated text of the response. */
async function complete({ system, messages, maxTokens = 1200, temperature = 0.5 }) {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    temperature,
    system,
    messages,
  });
  return response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
}

/** Returns a raw Anthropic MessageStream for the chat interface (supports text + tool_use blocks). */
function streamChat({ system, messages, tools }) {
  return anthropic.messages.stream({
    model: MODEL,
    max_tokens: 1500,
    system,
    messages,
    tools,
  });
}

function baseContextBlock(context) {
  return `Current date/time: ${context.now}
User timezone: ${context.timezone || 'America/New_York'}
User name: ${context.userName || 'there'}

TODAY'S CALENDAR EVENTS:
${JSON.stringify(context.todayEvents || [], null, 2)}

PENDING SCHOOL TASKS:
${JSON.stringify(context.schoolTasks || [], null, 2)}

UPCOMING WORK SHIFTS:
${JSON.stringify(context.workShifts || [], null, 2)}

UNRESOLVED RSVPs:
${JSON.stringify(context.rsvps || [], null, 2)}`;
}

async function generateMorningBrief(context) {
  const system = `You are a warm, upbeat, and concise personal scheduling assistant writing a short morning briefing.
Rules:
- Keep it under 200 words.
- Mention today's key events, any work shift, urgent school deadlines (due today or overdue), and pending RSVPs that need a response.
- Flag any scheduling conflicts clearly if present.
- End on an encouraging note.
- Plain text only, no markdown headers, suitable for email and SMS.`;
  const userMessage = `Write today's morning briefing from this data:\n\n${baseContextBlock(context)}\n\nCONFLICTS TODAY:\n${JSON.stringify(context.conflicts || [], null, 2)}`;
  return complete({ system, messages: [{ role: 'user', content: userMessage }], maxTokens: 500 });
}

async function generateWeeklyPreview(context) {
  const system = `You are a friendly personal scheduling assistant writing a Sunday-evening "week ahead" preview.
Rules:
- Keep it under 350 words.
- Organize loosely by day where useful, mentioning shifts, school deadlines, events, and pending RSVPs.
- Point out the busiest day and any day that looks unusually light.
- Flag conflicts if present.
- Plain text only, no markdown headers, suitable for email and SMS.`;
  const userMessage = `Write this week's preview from this data:\n\nCurrent date/time: ${context.now}\n\nTHIS WEEK'S EVENTS:\n${JSON.stringify(context.weekEvents || [], null, 2)}\n\nSCHOOL DEADLINES THIS WEEK:\n${JSON.stringify(context.schoolTasks || [], null, 2)}\n\nWORK SHIFTS THIS WEEK:\n${JSON.stringify(context.workShifts || [], null, 2)}\n\nPENDING RSVPs:\n${JSON.stringify(context.rsvps || [], null, 2)}\n\nCONFLICTS:\n${JSON.stringify(context.conflicts || [], null, 2)}`;
  return complete({ system, messages: [{ role: 'user', content: userMessage }], maxTokens: 700 });
}

async function parseRsvpEmail({ subject, from, text }) {
  const system = `You extract event-invitation details from an email. Respond with ONLY a JSON object, no prose, no markdown fences.
Schema: { "isInvite": boolean, "title": string|null, "date": "YYYY-MM-DD"|null, "time": "HH:MM"|null, "location": string|null, "organizer": string|null }
Set "isInvite" to false if this email is not actually an event invitation/RSVP request (e.g. it's a newsletter or receipt). Infer the year from context if missing; assume the nearest future occurrence. If time is not specified assume it's an all-day event and set time to null.`;
  const userMessage = `Subject: ${subject}\nFrom: ${from}\n\nBody:\n${(text || '').slice(0, 6000)}`;
  const raw = await complete({ system, messages: [{ role: 'user', content: userMessage }], maxTokens: 400, temperature: 0.1 });
  return extractJson(raw) || { isInvite: false };
}

async function parseHotSchedulesEmail({ subject, text }) {
  const system = `You extract work shift schedules from a HotSchedules (restaurant/retail shift scheduling software) notification email. Respond with ONLY a JSON object, no prose, no markdown fences.
Schema: { "shifts": [ { "date": "YYYY-MM-DD", "start_time": "HH:MM", "end_time": "HH:MM", "role": string, "location": string|null } ] }
If the email lists multiple shifts across a week, return every one of them. If no valid shifts are found, return { "shifts": [] }. Use 24-hour HH:MM time format.`;
  const userMessage = `Subject: ${subject}\n\nBody:\n${(text || '').slice(0, 8000)}`;
  const raw = await complete({ system, messages: [{ role: 'user', content: userMessage }], maxTokens: 1200, temperature: 0.1 });
  return extractJson(raw) || { shifts: [] };
}

async function parseSchoolEmail({ subject, from, text, keywords, domains }) {
  const system = `You extract school assignment/exam details from an email sent by a school platform (Canvas, Blackboard, Google Classroom) or a professor. Respond with ONLY a JSON object, no prose, no markdown fences.
Schema: { "tasks": [ { "title": string, "course": string|null, "type": "homework"|"exam"|"quiz"|"project"|"other", "due_date": "YYYY-MM-DD" } ] }
The user is watching for these keywords: ${keywords}. Only extract items that represent an actual due date/deadline. If there is no clear due date, omit that item. If nothing qualifies, return { "tasks": [] }.`;
  const userMessage = `Subject: ${subject}\nFrom: ${from}\n\nBody:\n${(text || '').slice(0, 8000)}`;
  const raw = await complete({ system, messages: [{ role: 'user', content: userMessage }], maxTokens: 1000, temperature: 0.1 });
  return extractJson(raw) || { tasks: [] };
}

async function generateLifeBalanceSuggestions(context) {
  const system = `You are a thoughtful personal scheduling assistant. Given the user's free time blocks, pending school tasks, and upcoming deadlines, suggest a short list (2-4) of specific, actionable ways to use their free time well this week. Respond with ONLY a JSON object, no prose, no markdown fences.
Schema: { "suggestions": [ { "content": string, "suggested_for_date": "YYYY-MM-DD", "start_time": "HH:MM", "end_time": "HH:MM", "title": string } ] }
Each suggestion's "content" should be one friendly sentence explaining the why. "title" is a short calendar-event-style label (e.g. "Study session: Calc II"). Respect the user's minimum daily free-time buffer of ${context.freeTimeBufferHours} hours — do not suggest filling time below that buffer.`;
  const userMessage = `FREE TIME BLOCKS THIS WEEK:\n${JSON.stringify(context.freeBlocks || [], null, 2)}\n\nPENDING SCHOOL TASKS:\n${JSON.stringify(context.schoolTasks || [], null, 2)}\n\nUPCOMING EVENTS:\n${JSON.stringify(context.upcomingEvents || [], null, 2)}`;
  const raw = await complete({ system, messages: [{ role: 'user', content: userMessage }], maxTokens: 800, temperature: 0.6 });
  return extractJson(raw) || { suggestions: [] };
}

async function suggestConflictResolution(conflict) {
  const system = `You are a scheduling assistant. Two calendar events overlap. Suggest ONE specific resolution (e.g. move the lower-priority event earlier or later by a specific amount). Respond with ONLY a JSON object, no prose, no markdown fences.
Schema: { "explanation": string, "moveEventId": string, "newStart": "ISO datetime", "newEnd": "ISO datetime" }
Prefer moving school/personal events over fixed work shifts. Keep the same event duration when moving it. "explanation" should be one short friendly sentence.`;
  const userMessage = `CONFLICTING EVENTS:\nEvent A: ${JSON.stringify(conflict.eventA)}\nEvent B: ${JSON.stringify(conflict.eventB)}\n\nCurrent date/time: ${new Date().toISOString()}`;
  const raw = await complete({ system, messages: [{ role: 'user', content: userMessage }], maxTokens: 400, temperature: 0.3 });
  return extractJson(raw);
}

module.exports = {
  MODEL,
  complete,
  streamChat,
  extractJson,
  generateMorningBrief,
  generateWeeklyPreview,
  parseRsvpEmail,
  parseHotSchedulesEmail,
  parseSchoolEmail,
  generateLifeBalanceSuggestions,
  suggestConflictResolution,
};
