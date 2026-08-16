// On-demand chat interface: streams Claude's response token-by-token over
// Server-Sent Events, with full scheduling context and tool-use actions
// (schedule/move/delete events, mark homework complete, next shift lookup).
const express = require('express');
const router = express.Router();
const { db, getUser } = require('../db/db');
const claude = require('../services/claude');
const calendarService = require('../services/calendar');

const TOOLS = [
  {
    name: 'schedule_event',
    description: 'Create a new event on the user\'s Google Calendar.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        date: { type: 'string', description: 'YYYY-MM-DD' },
        start_time: { type: 'string', description: 'HH:MM 24-hour, omit for an all-day event' },
        end_time: { type: 'string', description: 'HH:MM 24-hour, omit for an all-day event' },
        location: { type: 'string' },
        description: { type: 'string' },
      },
      required: ['title', 'date'],
    },
  },
  {
    name: 'move_event',
    description: 'Move/reschedule an existing calendar event to a new date/time. Requires the event_id from the calendar context provided.',
    input_schema: {
      type: 'object',
      properties: {
        event_id: { type: 'string' },
        new_date: { type: 'string', description: 'YYYY-MM-DD' },
        new_start_time: { type: 'string', description: 'HH:MM 24-hour' },
        new_end_time: { type: 'string', description: 'HH:MM 24-hour' },
      },
      required: ['event_id', 'new_date', 'new_start_time', 'new_end_time'],
    },
  },
  {
    name: 'delete_event',
    description: 'Delete/cancel an existing calendar event. Requires the event_id from the calendar context provided.',
    input_schema: {
      type: 'object',
      properties: { event_id: { type: 'string' } },
      required: ['event_id'],
    },
  },
  {
    name: 'mark_homework_complete',
    description: 'Mark a school task/homework/assignment as complete.',
    input_schema: {
      type: 'object',
      properties: {
        task_id: { type: 'integer', description: 'The school_tasks id if known' },
        title: { type: 'string', description: 'The assignment title, used to look it up if task_id is unknown' },
      },
    },
  },
  {
    name: 'get_next_work_shift',
    description: 'Look up the user\'s next upcoming work shift from cached HotSchedules data.',
    input_schema: { type: 'object', properties: {} },
  },
];

async function executeTool(name, input) {
  switch (name) {
    case 'schedule_event': {
      const allDay = !input.start_time || !input.end_time;
      const start = allDay ? input.date : `${input.date}T${input.start_time}:00`;
      const end = allDay ? input.date : `${input.date}T${input.end_time}:00`;
      const event = await calendarService.createEvent({
        title: input.title,
        description: input.description,
        location: input.location,
        start,
        end,
        allDay,
      });
      return { success: true, event: { id: event.id, title: event.title, start: event.start, end: event.end } };
    }
    case 'move_event': {
      const start = `${input.new_date}T${input.new_start_time}:00`;
      const end = `${input.new_date}T${input.new_end_time}:00`;
      const event = await calendarService.updateEvent(input.event_id, { start, end });
      return { success: true, event: { id: event.id, title: event.title, start: event.start, end: event.end } };
    }
    case 'delete_event': {
      await calendarService.deleteEvent(input.event_id);
      return { success: true };
    }
    case 'mark_homework_complete': {
      let task = null;
      if (input.task_id) task = db.prepare('SELECT * FROM school_tasks WHERE id = ?').get(input.task_id);
      if (!task && input.title) {
        task = db.prepare('SELECT * FROM school_tasks WHERE title LIKE ? ORDER BY due_date ASC LIMIT 1').get(`%${input.title}%`);
      }
      if (!task) return { success: false, error: 'Could not find a matching school task.' };
      db.prepare(`UPDATE school_tasks SET status = 'complete' WHERE id = ?`).run(task.id);
      return { success: true, task: { id: task.id, title: task.title } };
    }
    case 'get_next_work_shift': {
      const now = new Date();
      const today = now.toISOString().slice(0, 10);
      const currentTime = now.toTimeString().slice(0, 5);
      const shift = db
        .prepare(`SELECT * FROM work_shifts WHERE date > ? OR (date = ? AND end_time > ?) ORDER BY date ASC, start_time ASC LIMIT 1`)
        .get(today, today, currentTime);
      return shift || { message: 'No upcoming shifts found.' };
    }
    default:
      return { success: false, error: `Unknown tool: ${name}` };
  }
}

function buildSystemPrompt(context) {
  return `You are a helpful, friendly AI personal scheduling assistant embedded in a web app. You can answer questions about the user's schedule and take real actions using the tools provided (schedule_event, move_event, delete_event, mark_homework_complete, get_next_work_shift).

Always use a tool when the user asks you to actually change something (schedule, move, delete, mark complete). Otherwise just answer conversationally using the context below. When you take an action, briefly confirm what you did in plain language. Be concise.

CURRENT CONTEXT
Current date/time: ${context.now}
Timezone: ${context.timezone}

TODAY'S CALENDAR EVENTS:
${JSON.stringify(context.todayEvents, null, 2)}

PENDING SCHOOL TASKS:
${JSON.stringify(context.schoolTasks, null, 2)}

UPCOMING WORK SHIFTS:
${JSON.stringify(context.workShifts, null, 2)}

PENDING RSVPs:
${JSON.stringify(context.rsvps, null, 2)}`;
}

router.get('/history', (req, res) => {
  const rows = db.prepare(`SELECT * FROM conversation_history ORDER BY timestamp ASC LIMIT 500`).all();
  res.json({ history: rows });
});

router.delete('/history', (req, res) => {
  db.prepare(`DELETE FROM conversation_history`).run();
  res.json({ success: true });
});

router.post('/message', async (req, res) => {
  const { message } = req.body;
  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'Message is required.' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const send = (type, data) => res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);

  db.prepare(`INSERT INTO conversation_history (role, content) VALUES ('user', ?)`).run(message);

  try {
    const user = getUser();
    const [todayEvents, schoolTasks, workShifts, rsvps] = await Promise.all([
      calendarService.getTodayEvents(user.timezone).catch(() => []),
      Promise.resolve(db.prepare(`SELECT * FROM school_tasks WHERE status = 'pending' ORDER BY due_date ASC LIMIT 15`).all()),
      Promise.resolve(db.prepare(`SELECT * FROM work_shifts WHERE date >= date('now') ORDER BY date ASC LIMIT 5`).all()),
      Promise.resolve(db.prepare(`SELECT * FROM rsvps WHERE status = 'pending' ORDER BY detected_at DESC LIMIT 10`).all()),
    ]);

    const system = buildSystemPrompt({
      now: new Date().toString(),
      timezone: user.timezone,
      todayEvents,
      schoolTasks,
      workShifts,
      rsvps,
    });

    const priorHistory = db
      .prepare(`SELECT role, content FROM conversation_history ORDER BY timestamp DESC LIMIT 21`)
      .all()
      .reverse()
      .slice(0, -1); // exclude the message we just inserted; we add it explicitly below

    let messages = [
      ...priorHistory.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: message },
    ];

    let finalText = '';
    let iterations = 0;
    const MAX_TOOL_ITERATIONS = 5;

    while (iterations < MAX_TOOL_ITERATIONS) {
      iterations += 1;
      const stream = claude.streamChat({ system, messages, tools: TOOLS });

      stream.on('text', (delta) => send('token', { text: delta }));
      stream.on('error', (err) => {
        console.error('[chat] Stream error:', err.message);
      });

      const finalMessage = await stream.finalMessage();
      const textBlocks = finalMessage.content.filter((b) => b.type === 'text');
      const toolUseBlocks = finalMessage.content.filter((b) => b.type === 'tool_use');
      finalText += textBlocks.map((b) => b.text).join('\n');

      messages.push({ role: 'assistant', content: finalMessage.content });

      if (toolUseBlocks.length === 0) break;

      const toolResults = [];
      for (const block of toolUseBlocks) {
        let result;
        try {
          result = await executeTool(block.name, block.input);
        } catch (err) {
          result = { success: false, error: err.message };
        }
        send('tool', { name: block.name, input: block.input, result });
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(result),
        });
      }
      messages.push({ role: 'user', content: toolResults });
      // Loop again so Claude can narrate the tool result(s) as text.
    }

    if (finalText.trim()) {
      db.prepare(`INSERT INTO conversation_history (role, content) VALUES ('assistant', ?)`).run(finalText.trim());
    }

    send('done', {});
    res.end();
  } catch (err) {
    console.error('[chat] Failed to handle message:', err.message);
    send('error', { message: err.message || 'Something went wrong talking to Claude.' });
    res.end();
  }
});

module.exports = router;
