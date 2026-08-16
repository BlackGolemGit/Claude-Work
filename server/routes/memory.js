// Long-term personal memory: facts, preferences, routines, and people the
// agent has learned about the user, editable directly and also written to
// by Claude during chat (see the `remember` tool in routes/chat.js). Read
// into every Claude prompt (chat, morning brief, weekly preview, life
// balance suggestions) so the agent gets more personalized over time.
const express = require('express');
const router = express.Router();
const { listMemories, addMemory, updateMemory, deleteMemory } = require('../db/db');

function asyncHandler(fn) {
  return (req, res, next) => fn(req, res, next).catch((err) => {
    console.error(`[memory route] ${req.method} ${req.originalUrl}:`, err.message);
    res.status(500).json({ error: err.message || 'Something went wrong.' });
  });
}

router.get('/', asyncHandler(async (req, res) => {
  const { category } = req.query;
  res.json({ memories: listMemories({ category: category || null }) });
}));

router.post('/', asyncHandler(async (req, res) => {
  const { content, category } = req.body;
  if (!content || !content.trim()) return res.status(400).json({ error: 'Content is required.' });
  const memory = addMemory({ content: content.trim(), category: category || 'general', source: 'manual' });
  res.json({ memory });
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const { content, category, pinned } = req.body;
  const memory = updateMemory(req.params.id, {
    ...(content !== undefined ? { content } : {}),
    ...(category !== undefined ? { category } : {}),
    ...(pinned !== undefined ? { pinned: pinned ? 1 : 0 } : {}),
  });
  res.json({ memory });
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  deleteMemory(req.params.id);
  res.json({ success: true });
}));

module.exports = router;
