const express = require('express');
const router = express.Router();
const db = require('../database');
const chat = require('../chat');
const agentManager = require('../agent-manager');
const rules = require('../rules');
const skills = require('../skills');
const scenes = require('../scenes');
const context = require('../context');

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

// GET /api/platform/stats - 获取运行时统计
router.get('/stats', (req, res) => {
  const ruleHitCounts = db.getRuleHitCounts();
  const allRules = db.getAllRules();
  const activeScene = scenes.getActiveScene();
  const onlineAgents = agentManager.getAgentStatus().filter(a => a.status === 'online').length;
  const messageStats = db.getMessageStats();

  res.json({
    success: true,
    stats: {
      rules_total: allRules.length,
      rules_enabled: allRules.filter(r => r.enabled).length,
      rules_total_hits: Object.values(ruleHitCounts).reduce((s, c) => s + c, 0),
      rule_hits: ruleHitCounts,
      skills_total: db.getActiveSkills().length,
      skill_calls: db.getSkillCallStats(),
      scenes_total: db.getEnabledScenes().length,
      active_scene: activeScene ? activeScene.name : null,
      online_agents: onlineAgents,
      total_messages: messageStats.total
    }
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

// ==================== 规则 API ====================

// GET /api/platform/rules - 获取规则列表
router.get('/rules', (req, res) => {
  const rulesList = db.getAllRules();
  res.json({ success: true, rules: rulesList, version: context.getRulesVersion() });
});

// GET /api/platform/rules/:id - 获取规则详情
router.get('/rules/:id', (req, res) => {
  const rule = db.getRuleById(req.params.id);
  if (!rule) {
    return res.status(404).json({ error: '规则不存在' });
  }
  res.json({ success: true, rule });
});

// POST /api/platform/rules - 新增规则
router.post('/rules', (req, res) => {
  const { id, summary, trigger, must, must_not, priority, version } = req.body;

  if (!id || !summary || !trigger) {
    return res.status(400).json({ error: 'id、summary 和 trigger 必填' });
  }

  try {
    const rule = db.createRule({ id, summary, trigger, must, must_not, priority, version });
    console.log(`[API] 创建规则: ${id}`);
    agentManager.broadcastRulesSync();
    res.json({ success: true, rule });
  } catch (e) {
    res.status(400).json({ error: '创建失败: ' + e.message });
  }
});

// PUT /api/platform/rules/:id - 更新规则
router.put('/rules/:id', (req, res) => {
  const { id } = req.params;
  const updates = req.body;

  try {
    const rule = db.updateRule(id, updates);
    if (!rule) {
      return res.status(404).json({ error: '规则不存在' });
    }
    console.log(`[API] 更新规则: ${id}`);
    agentManager.broadcastRulesSync();
    res.json({ success: true, rule });
  } catch (e) {
    res.status(400).json({ error: '更新失败: ' + e.message });
  }
});

// DELETE /api/platform/rules/:id - 删除规则
router.delete('/rules/:id', (req, res) => {
  const { id } = req.params;
  db.deleteRule(id);
  console.log(`[API] 删除规则: ${id}`);
  agentManager.broadcastRulesSync();
  res.json({ success: true });
});

// GET /api/platform/rules/audit - 获取规则审计日志
router.get('/rules/audit', (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  const logs = db.getRuleAuditLogs(limit);
  res.json({ success: true, logs });
});

// ==================== 技能 API ====================

// GET /api/platform/skills - 获取技能列表
router.get('/skills', (req, res) => {
  const skillsList = skills.getAvailableSkills();
  res.json({ success: true, skills: skillsList });
});

// GET /api/platform/skills/:id - 获取技能详情
router.get('/skills/:id', (req, res) => {
  const skill = skills.getSkillDetail(req.params.id);
  if (!skill) {
    return res.status(404).json({ error: '技能不存在' });
  }
  res.json({ success: true, skill });
});

// POST /api/platform/skills - 新增技能
router.post('/skills', (req, res) => {
  const { id, name, description, category, input_schema, output_schema, usage_hint } = req.body;

  if (!id || !name) {
    return res.status(400).json({ error: 'id 和 name 必填' });
  }

  try {
    const skill = skills.registerSkill({ id, name, description, category, input_schema, output_schema, usage_hint });
    console.log(`[API] 创建技能: ${id}`);
    agentManager.broadcastSkillsSync();
    res.json({ success: true, skill });
  } catch (e) {
    res.status(400).json({ error: '创建失败: ' + e.message });
  }
});

// PUT /api/platform/skills/:id - 更新技能
router.put('/skills/:id', (req, res) => {
  const { id } = req.params;
  const updates = req.body;

  try {
    const skill = skills.updateSkill(id, updates);
    console.log(`[API] 更新技能: ${id}`);
    agentManager.broadcastSkillsSync();
    res.json({ success: true, skill });
  } catch (e) {
    res.status(400).json({ error: '更新失败: ' + e.message });
  }
});

// DELETE /api/platform/skills/:id - 删除技能
router.delete('/skills/:id', (req, res) => {
  const { id } = req.params;
  try {
    skills.unregisterSkill(id);
    console.log(`[API] 删除技能: ${id}`);
    agentManager.broadcastSkillsSync();
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: '删除失败: ' + e.message });
  }
});

// POST /api/platform/skills/call - 调用技能
router.post('/skills/call', async (req, res) => {
  const { skill_id, input } = req.body;

  if (!skill_id) {
    return res.status(400).json({ error: 'skill_id 必填' });
  }

  try {
    const result = await skills.executeSkill(
      { payload: { skill_id, input } },
      { id: 'http-api' }
    );
    if (result.status === 'failed') {
      return res.status(400).json({ error: result.error, message: result.message });
    }
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(500).json({ error: '执行失败: ' + e.message });
  }
});

// GET /api/platform/skills/logs - 获取技能调用日志
router.get('/skills/logs', (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  const logs = db.getSkillCallLogs(limit);
  res.json({ success: true, logs });
});

// ==================== 场景 API（统一模式管理） ====================

// GET /api/platform/scenes - 获取场景列表
router.get('/scenes', (req, res) => {
  const list = scenes.getAvailableScenes();
  res.json({ success: true, scenes: list });
});

// GET /api/platform/scenes/active - 获取当前活跃场景
router.get('/scenes/active', (req, res) => {
  const active = scenes.getActiveScene();
  res.json({ success: true, scene: active });
});

// GET /api/platform/scenes/:id - 获取场景详情
router.get('/scenes/:id', (req, res) => {
  const scene = db.getSceneById(req.params.id);
  if (!scene) return res.status(404).json({ error: '场景不存在' });
  res.json({ success: true, scene });
});

// POST /api/platform/scenes - 新增场景
router.post('/scenes', (req, res) => {
  const { id, name, description, icon, context_prompt, trigger_keywords, auto_activate, skills } = req.body;
  if (!id || !name || !context_prompt) {
    return res.status(400).json({ error: 'id、name 和 context_prompt 必填' });
  }
  try {
    const scene = scenes.createScene({ id, name, description, icon, context_prompt, trigger_keywords, auto_activate, skills });
    console.log(`[API] 创建场景: ${id}`);
    res.json({ success: true, scene });
  } catch (e) { res.status(400).json({ error: '创建失败: ' + e.message }); }
});

// PUT /api/platform/scenes/:id - 更新场景
router.put('/scenes/:id', (req, res) => {
  try {
    const scene = scenes.updateScene(req.params.id, req.body);
    console.log(`[API] 更新场景: ${req.params.id}`);
    res.json({ success: true, scene });
  } catch (e) { res.status(400).json({ error: '更新失败: ' + e.message }); }
});

// DELETE /api/platform/scenes/:id - 删除场景
router.delete('/scenes/:id', (req, res) => {
  try {
    scenes.deleteScene(req.params.id);
    console.log(`[API] 删除场景: ${req.params.id}`);
    res.json({ success: true });
  } catch (e) { res.status(400).json({ error: '删除失败: ' + e.message }); }
});

// POST /api/platform/scenes/:id/activate - 激活场景
router.post('/scenes/:id/activate', (req, res) => {
  try {
    const scene = scenes.activateScene(req.params.id, req.body.activated_by || 'admin', req.body.participants || []);
    console.log(`[API] 激活场景: ${req.params.id}`);
    res.json({ success: true, scene });
  } catch (e) { res.status(400).json({ error: '激活失败: ' + e.message }); }
});

// POST /api/platform/scenes/:id/deactivate - 结束场景
router.post('/scenes/:id/deactivate', (req, res) => {
  try {
    scenes.deactivateScene(req.params.id);
    console.log(`[API] 结束场景: ${req.params.id}`);
    res.json({ success: true });
  } catch (e) { res.status(400).json({ error: '结束失败: ' + e.message }); }
});

// ==================== 上下文 API ====================

// GET /api/platform/context - 获取平台上下文
router.get('/context', (req, res) => {
  const agentId = req.query.agent_id;

  if (agentId) {
    const fullContext = context.getFullContext(agentId);
    res.json({ success: true, context: fullContext });
  } else {
    // 返回全局上下文信息
    res.json({
      success: true,
      context: {
        rules_version: context.getRulesVersion(),
        available_scenes: scenes.getAvailableScenes().map(s => s.id),
        available_skills: skills.getAvailableSkills().map(s => s.id)
      }
    });
  }
});

// GET /api/platform/context/runtime - 获取运行时状态
router.get('/context/runtime', (req, res) => {
  const agentId = req.query.agent_id;
  if (!agentId) {
    return res.status(400).json({ error: 'agent_id 必填' });
  }

  const runtimeState = context.getRuntimeState(null, agentId);
  res.json({ success: true, runtime_state: runtimeState });
});

// ==================== Agent 能力声明 API ====================

// GET /api/platform/agents/:id/skills - 获取 Agent 技能声明
router.get('/agents/:id/skills', (req, res) => {
  const { id } = req.params;
  const declaration = db.getAgentSkillDeclaration(id);

  res.json({
    success: true,
    agent_id: id,
    declared_skills: declaration?.declared_skills || []
  });
});

// PUT /api/platform/agents/:id/skills - 更新 Agent 技能声明
router.put('/agents/:id/skills', (req, res) => {
  const { id } = req.params;
  const { declared_skills } = req.body;

  if (!Array.isArray(declared_skills)) {
    return res.status(400).json({ error: 'declared_skills 应为数组' });
  }

  const declaration = db.setAgentSkillDeclaration(id, declared_skills);
  console.log(`[API] 更新 Agent ${id} 技能声明: ${declared_skills.join(', ')}`);
  res.json({ success: true, declaration });
});

module.exports = router;