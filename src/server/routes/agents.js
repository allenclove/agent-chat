const express = require('express');
const router = express.Router();
const db = require('../database');
const agentManager = require('../agent-manager');
const chat = require('../chat');
const adminAuth = require('../middleware/adminAuth');

// GET /api/agents - 获取 Agent 状态列表
router.get('/', (req, res) => {
  const agents = agentManager.getAgentStatus();
  res.json({ success: true, agents });
});

// GET /api/agents/:id/config - 获取单个 Agent 配置
router.get('/:id/config', adminAuth, (req, res) => {
  const { id: agentId } = req.params;
  const config = db.getAgentFullConfig(agentId);

  if (!config) {
    return res.status(404).json({ error: 'Agent 不存在' });
  }

  // 移除敏感信息
  delete config.token;

  res.json({ success: true, config });
});

// PUT /api/agents/:id/config - 更新 Agent 配置
router.put('/:id/config', adminAuth, (req, res) => {
  const { id: agentId } = req.params;
  const settings = req.body;

  // 验证设置字段
  const allowedFields = ['name', 'persona', 'conversation_mode', 'custom_settings', 'history_limit', 'message_filter', 'keywords'];
  const filteredSettings = {};
  for (const key of allowedFields) {
    if (settings[key] !== undefined) {
      filteredSettings[key] = settings[key];
    }
  }

  const updated = db.updateAgentSettings(agentId, filteredSettings);

  if (!updated) {
    return res.status(404).json({ error: 'Agent 不存在' });
  }

  console.log(`[API] Agent ${agentId} 配置已更新`);

  // 通知该 Agent 重新加载配置
  agentManager.notifyAgentConfigChanged(agentId);

  // 如果名称变更，广播给所有用户更新 Agent 列表
  if (filteredSettings.name !== undefined) {
    chat.broadcast('agent_status', {
      agent_id: agentId,
      name: filteredSettings.name,
      status: agentManager.getAgentStatus().find(a => a.id === agentId)?.status || 'offline'
    });
  }

  res.json({ success: true, config: updated });
});

module.exports = router;