const express = require('express');
const router = express.Router();
const db = require('../database');
const chat = require('../chat');

// GET /api/platform/messages - 获取历史消息
router.get('/messages', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const before = req.query.before ? parseInt(req.query.before) : null;
  const after = req.query.after ? parseInt(req.query.after) : null;
  const senderType = req.query.sender_type || null;

  const messages = db.getRecentMessages(limit, before, after, senderType);
  res.json({ success: true, messages });
});

// GET /api/platform/participants - 获取群成员列表
router.get('/participants', (req, res) => {
  const onlineUsers = chat.getOnlineUsers();
  const allAgents = db.getAllAgents();

  res.json({
    success: true,
    participants: [
      ...onlineUsers.map(u => ({
        id: u.id,
        name: u.display_name || u.username,
        type: 'human',
        online: true
      })),
      ...allAgents.map(a => ({
        id: a.id,
        name: a.name,
        type: 'agent',
        online: true
      }))
    ]
  });
});

// GET /api/platform/online - 获取在线状态
router.get('/online', (req, res) => {
  const onlineUsers = chat.getOnlineUsers();
  const allAgents = db.getAllAgents();

  res.json({
    success: true,
    online: {
      humans: onlineUsers.length,
      agents: allAgents.length,
      user_list: onlineUsers.map(u => u.display_name || u.username),
      agent_list: allAgents.map(a => a.name)
    }
  });
});

// GET /api/platform/topics - 获取话题列表
router.get('/topics', (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  const topics = db.getTopics(limit);
  res.json({ success: true, topics });
});

// GET /api/platform/search - 搜索消息
router.get('/search', (req, res) => {
  const q = req.query.q || '';
  const limit = parseInt(req.query.limit) || 20;

  if (!q || q.length < 2) {
    return res.status(400).json({ error: '搜索关键词至少需要2个字符' });
  }

  const results = db.searchMessages(q, limit);
  res.json({ success: true, query: q, results });
});

// GET /api/platform/time - 获取服务器时间
router.get('/time', (req, res) => {
  res.json({
    success: true,
    time: db.formatShanghaiTime(new Date()),
    timestamp: Date.now()
  });
});

module.exports = router;