const express = require('express');
const router = express.Router();
const db = require('../database');
const agentManager = require('../agent-manager');

// GET /api/topics - 获取话题列表
router.get('/', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const offset = parseInt(req.query.offset) || 0;

  const topics = db.getTopics(limit, offset);
  res.json({ success: true, topics });
});

// POST /api/topics - 创建话题
router.post('/', (req, res) => {
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

// GET /api/topics/:id - 获取话题详情
router.get('/:id', (req, res) => {
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

// PUT /api/topics/:id - 更新话题
router.put('/:id', (req, res) => {
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

// DELETE /api/topics/:id - 删除话题
router.delete('/:id', (req, res) => {
  const { id: topicId } = req.params;
  db.deleteTopic(topicId);
  console.log(`[API] 删除话题: ${topicId}`);
  res.json({ success: true });
});

// POST /api/topics/:id/messages - 添加消息到话题
router.post('/:id/messages', (req, res) => {
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

// POST /api/topics/:id/summary - 保存总结
router.post('/:id/summary', (req, res) => {
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

// POST /api/topics/:id/generate-summary - 请求Agent生成总结
router.post('/:id/generate-summary', (req, res) => {
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

// GET /api/topics/:id/export - 导出话题
router.get('/:id/export', (req, res) => {
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
    content += `**创建时间**: ${topic.created_at}\n\n`;
    content += `---\n\n`;
    content += `## 聊天记录\n\n`;
    messages.forEach(msg => {
      const time = msg.original_created_at || '';
      content += `**${msg.sender_name}** (${msg.sender_type}) - ${time}:\n${msg.content}\n\n`;
    });
    if (summary) {
      content += `---\n\n`;
      content += `## 总结\n\n`;
      content += `${summary.narrative}\n\n`;
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