const express = require('express');
const router = express.Router();
const db = require('../database');
const chat = require('../chat');
const agentManager = require('../agent-manager');
const adminAuth = require('../middleware/adminAuth');

// GET /api/messages/stats - 获取消息统计
router.get('/stats', (req, res) => {
  const stats = db.getMessageStats();
  res.json({ success: true, stats });
});

// POST /api/messages/clear - 清空所有消息 (需要管理员权限)
router.post('/clear', adminAuth, (req, res) => {
  const deleted = db.clearMessages();

  // 广播清空通知
  chat.broadcast('clear_history', {});
  agentManager.broadcastClearHistory();

  console.log(`[Messages] 已清空 ${deleted} 条消息`);
  res.json({ success: true, deleted });
});

module.exports = router;