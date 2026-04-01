const express = require('express');
const router = express.Router();
const db = require('../database');
const chat = require('../chat');
const agentManager = require('../agent-manager');

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

// ==================== 话题 API ====================

// GET /api/platform/topics - 获取话题列表
router.get('/topics', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const offset = parseInt(req.query.offset) || 0;
  const topics = db.getTopics(limit, offset);
  res.json({ success: true, topics });
});

// POST /api/platform/topics - 创建话题
router.post('/topics', (req, res) => {
  const { title, description, message_ids, created_by } = req.body;

  if (!title || !title.trim()) {
    return res.status(400).json({ error: '标题不能为空' });
  }

  try {
    const topic = db.createTopic(title.trim(), description, created_by, message_ids);
    console.log(`[API] 创建话题: ${topic.title}`);
    res.json({ success: true, topic });
  } catch (e) {
    res.status(400).json({ error: '创建失败: ' + e.message });
  }
});

// GET /api/platform/topics/:id - 获取话题详情
router.get('/topics/:id', (req, res) => {
  const { id: topicId } = req.params;
  const topic = db.getTopicById(topicId);

  if (!topic) {
    return res.status(404).json({ error: '话题不存在' });
  }

  const messages = db.getTopicMessages(topicId);
  const summary = db.getTopicSummary(topicId);

  res.json({
    success: true,
    topic: { ...topic, messages, summary }
  });
});

// PUT /api/platform/topics/:id - 更新话题
router.put('/topics/:id', (req, res) => {
  const { id: topicId } = req.params;
  const { title, description } = req.body;

  try {
    db.updateTopic(topicId, title, description);
    console.log(`[API] 更新话题: ${topicId}`);
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: '更新失败' });
  }
});

// DELETE /api/platform/topics/:id - 删除话题
router.delete('/topics/:id', (req, res) => {
  const { id: topicId } = req.params;
  db.deleteTopic(topicId);
  console.log(`[API] 删除话题: ${topicId}`);
  res.json({ success: true });
});

// POST /api/platform/topics/:id/messages - 添加消息到话题
router.post('/topics/:id/messages', (req, res) => {
  const { id: topicId } = req.params;
  const { message_ids } = req.body;

  try {
    const added = db.addMessagesToTopic(topicId, message_ids);
    console.log(`[API] 添加 ${added} 条消息到话题 ${topicId}`);
    res.json({ success: true, added });
  } catch (e) {
    res.status(400).json({ error: '添加失败' });
  }
});

// POST /api/platform/topics/:id/summary - 保存总结
router.post('/topics/:id/summary', (req, res) => {
  const { id: topicId } = req.params;
  const { narrative, viewpoints, consensus, open_questions } = req.body;

  if (!narrative) {
    return res.status(400).json({ error: '总结内容不能为空' });
  }

  try {
    const summary = db.saveTopicSummary(topicId, narrative, viewpoints, consensus, open_questions);
    console.log(`[API] 保存话题总结: ${topicId}`);
    res.json({ success: true, summary });
  } catch (e) {
    res.status(400).json({ error: '保存失败' });
  }
});

// POST /api/platform/topics/:id/generate-summary - 请求Agent生成总结
router.post('/topics/:id/generate-summary', (req, res) => {
  const { id: topicId } = req.params;

  const topic = db.getTopicById(topicId);
  if (!topic) {
    return res.status(404).json({ error: '话题不存在' });
  }

  const messages = db.getTopicMessages(topicId);
  if (messages.length === 0) {
    return res.status(400).json({ error: '话题没有消息' });
  }

  const result = agentManager.requestTopicSummary(topicId, topic.title, messages);

  if (result.success) {
    res.json({
      success: true,
      message: `已请求 ${result.agentName} 生成总结，请稍候...`
    });
  } else {
    res.status(400).json({ error: result.error || '没有可用的Agent' });
  }
});

// GET /api/platform/topics/:id/export - 导出话题
router.get('/topics/:id/export', (req, res) => {
  const { id: topicId } = req.params;
  const format = req.query.format || 'markdown';

  const topic = db.getTopicById(topicId);
  if (!topic) {
    return res.status(404).json({ error: '话题不存在' });
  }

  const messages = db.getTopicMessages(topicId);
  const summary = db.getTopicSummary(topicId);

  let content, filename, contentType;

  if (format === 'json') {
    content = JSON.stringify({ topic, messages, summary }, null, 2);
    filename = `topic-${topicId}.json`;
    contentType = 'application/json';
  } else {
    content = `# ${topic.title}\n\n`;
    if (topic.description) {
      content += `> ${topic.description}\n\n`;
    }
    content += `**创建时间**: ${topic.created_at}\n\n---\n\n## 聊天记录\n\n`;
    messages.forEach(msg => {
      const time = msg.original_created_at || '';
      content += `**${msg.sender_name}** (${msg.sender_type}) - ${time}:\n${msg.content}\n\n`;
    });
    if (summary) {
      content += `---\n\n## 总结\n\n${summary.narrative}\n\n`;
      if (summary.viewpoints && summary.viewpoints.length > 0) {
        content += `### 各方观点\n\n`;
        summary.viewpoints.forEach(v => {
          content += `- **${v.name}** (${v.type}): ${v.summary}\n`;
        });
      }
      if (summary.consensus) {
        content += `\n### 共识\n${summary.consensus}\n`;
      }
    }
    filename = `topic-${topicId}.md`;
    contentType = 'text/markdown';
  }

  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(content);
});

module.exports = router;