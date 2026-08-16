require('../testSetup');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { findConflicts, hasConflict, normalizeEvent } = require('../services/calendar');

function ev(id, start, end, allDay = false) {
  return { id, title: id, start, end, allDay };
}

test('findConflicts detects overlapping timed events', () => {
  const events = [
    ev('a', '2026-01-01T09:00:00', '2026-01-01T10:00:00'),
    ev('b', '2026-01-01T09:30:00', '2026-01-01T11:00:00'), // overlaps a
    ev('c', '2026-01-01T12:00:00', '2026-01-01T13:00:00'), // no overlap
  ];
  const conflicts = findConflicts(events);
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].eventA.id, 'a');
  assert.equal(conflicts[0].eventB.id, 'b');
});

test('findConflicts ignores all-day events', () => {
  const events = [
    ev('a', '2026-01-01', '2026-01-02', true),
    ev('b', '2026-01-01', '2026-01-02', true),
  ];
  assert.equal(findConflicts(events).length, 0);
});

test('findConflicts returns empty for non-overlapping back-to-back events', () => {
  const events = [
    ev('a', '2026-01-01T09:00:00', '2026-01-01T10:00:00'),
    ev('b', '2026-01-01T10:00:00', '2026-01-01T11:00:00'),
  ];
  assert.equal(findConflicts(events).length, 0);
});

test('findConflicts handles many overlapping events (N^2 worst case) without exploding', () => {
  const events = [];
  for (let i = 0; i < 200; i++) {
    events.push(ev(`e${i}`, '2026-01-01T09:00:00', '2026-01-01T17:00:00'));
  }
  const start = Date.now();
  const conflicts = findConflicts(events);
  const elapsed = Date.now() - start;
  assert.equal(conflicts.length, (200 * 199) / 2);
  assert.ok(elapsed < 2000, `findConflicts took too long: ${elapsed}ms`);
});

test('hasConflict detects overlap against a candidate window', () => {
  const events = [ev('a', '2026-01-01T09:00:00', '2026-01-01T10:00:00')];
  assert.equal(hasConflict(events, '2026-01-01T09:30:00', '2026-01-01T09:45:00'), true);
  assert.equal(hasConflict(events, '2026-01-01T10:00:00', '2026-01-01T11:00:00'), false);
});

test('normalizeEvent tags category from emoji-prefixed titles', () => {
  const work = normalizeEvent({ id: '1', summary: '🏢 Work Shift — Cashier', start: { dateTime: '2026-01-01T09:00:00' }, end: { dateTime: '2026-01-01T17:00:00' } });
  const school = normalizeEvent({ id: '2', summary: '📚 HW Due: Essay', start: { dateTime: '2026-01-01T09:00:00' }, end: { dateTime: '2026-01-01T09:00:00' } });
  const personal = normalizeEvent({ id: '3', summary: 'Dentist', start: { dateTime: '2026-01-01T09:00:00' }, end: { dateTime: '2026-01-01T09:30:00' } });
  assert.equal(work.category, 'work');
  assert.equal(school.category, 'school');
  assert.equal(personal.category, 'personal');
});
