const express = require('express');
const router = express.Router();
const { traceStore, EVENT_TYPES } = require('../trace-store');
const db = require('../database');

// GET /api/debug/messages - 获取最近消息（带 trace_id）
router.get('/messages', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const messages = db.getRecentMessages(limit);
  const msgs = messages.map(m => ({
    ...m,
    trace_id: traceStore.getTraceIdByMessageId(m.id) || null
  }));
  res.json({ success: true, messages: msgs, recording: traceStore.isRecording() });
});

// GET /api/debug/traces/:traceId - 获取追踪详情
router.get('/traces/:traceId', (req, res) => {
  const { traceId } = req.params;
  const trace = traceStore.getTrace(traceId);
  if (!trace) {
    return res.status(404).json({ error: '追踪记录不存在' });
  }
  res.json({ success: true, trace: { trace_id: traceId, ...trace } });
});

// GET /api/debug/stats - 获取追踪统计
router.get('/stats', (req, res) => {
  const stats = traceStore.getStats();
  res.json({ success: true, stats });
});

// GET /api/debug/event-types - 获取事件类型列表
router.get('/event-types', (req, res) => {
  res.json({ success: true, event_types: EVENT_TYPES });
});

module.exports = router;