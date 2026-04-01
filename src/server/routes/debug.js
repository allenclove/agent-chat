const express = require('express');
const router = express.Router();
const { traceStore, EVENT_TYPES } = require('../trace-store');
const adminAuth = require('../middleware/adminAuth');

// GET /api/debug/traces - 获取最近的追踪记录列表
router.get('/traces', adminAuth, (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const traces = traceStore.getRecentTraces(limit);
  res.json({ success: true, traces });
});

// GET /api/debug/traces/:traceId - 获取追踪详情
router.get('/traces/:traceId', adminAuth, (req, res) => {
  const { traceId } = req.params;
  const trace = traceStore.getTrace(traceId);

  if (!trace) {
    return res.status(404).json({ error: '追踪记录不存在' });
  }

  res.json({
    success: true,
    trace: {
      trace_id: traceId,
      ...trace
    }
  });
});

// GET /api/debug/traces/message/:messageId - 通过消息ID获取追踪
router.get('/traces/message/:messageId', adminAuth, (req, res) => {
  const { messageId } = req.params;
  const trace = traceStore.getTraceByMessageId(messageId);

  if (!trace) {
    return res.status(404).json({ error: '未找到该消息的追踪记录' });
  }

  const traceId = traceStore.getTraceIdByMessageId(messageId);
  res.json({
    success: true,
    trace: {
      trace_id: traceId,
      ...trace
    }
  });
});

// GET /api/debug/stats - 获取追踪统计信息
router.get('/stats', adminAuth, (req, res) => {
  const stats = traceStore.getStats();
  res.json({ success: true, stats });
});

// DELETE /api/debug/traces - 清空追踪记录
router.delete('/traces', adminAuth, (req, res) => {
  traceStore.clear();
  res.json({ success: true, message: '追踪记录已清空' });
});

// GET /api/debug/event-types - 获取事件类型列表
router.get('/event-types', (req, res) => {
  res.json({ success: true, event_types: EVENT_TYPES });
});

module.exports = router;