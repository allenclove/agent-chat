const express = require('express');
const router = express.Router();
const db = require('../database');
const agentManager = require('../agent-manager');
const chat = require('../chat');
const adminAuth = require('../middleware/adminAuth');

// 所有管理员路由需要认证
router.use(adminAuth);

// GET /api/admin/join-requests - 获取所有接入申请
router.get('/join-requests', (req, res) => {
  const status = req.query.status || 'all';

  let requests;
  if (status === 'all') {
    requests = db.getAllJoinRequests();
  } else {
    requests = db.getJoinRequestsByStatus(status);
  }

  res.json({
    success: true,
    requests: requests || [],
    count: requests ? requests.length : 0
  });
});

// GET /api/admin/join-requests/stats - 获取接入申请统计
router.get('/join-requests/stats', (req, res) => {
  const pending = db.getJoinRequestsByStatus('pending');
  const approved = db.getJoinRequestsByStatus('approved');
  const rejected = db.getJoinRequestsByStatus('rejected');
  const active = db.getJoinRequestsByStatus('active');

  res.json({
    success: true,
    stats: {
      pending: pending ? pending.length : 0,
      approved: approved ? approved.length : 0,
      rejected: rejected ? rejected.length : 0,
      active: active ? active.length : 0
    }
  });
});

// POST /api/admin/join-requests/:id/approve - 批准接入申请
router.post('/join-requests/:id/approve', (req, res) => {
  const { id: requestId } = req.params;
  const platformConfig = req.body || {};

  const result = agentManager.approveJoinRequest(requestId, platformConfig, 'admin');

  if (result.success) {
    res.json({
      success: true,
      message: `Agent "${result.displayName}" 已批准`,
      display_name: result.displayName
    });
  } else {
    res.status(400).json({ success: false, error: result.error });
  }
});

// POST /api/admin/join-requests/:id/reject - 拒绝接入申请
router.post('/join-requests/:id/reject', (req, res) => {
  const { id: requestId } = req.params;
  const { reason = '不符合接入要求' } = req.body || {};

  const result = agentManager.rejectJoinRequest(requestId, reason, 'admin');

  if (result.success) {
    res.json({ success: true, message: '申请已拒绝' });
  } else {
    res.status(400).json({ success: false, error: result.error });
  }
});

// POST /api/admin/join-requests/:id/extend - 延长激活窗口
router.post('/join-requests/:id/extend', (req, res) => {
  const { id: requestId } = req.params;
  const { days = 7 } = req.body || {};

  const request = db.getJoinRequestById(requestId);
  if (!request) {
    return res.status(404).json({ success: false, error: '申请不存在' });
  }

  if (request.status !== 'approved') {
    return res.status(400).json({ success: false, error: '只有已批准的申请可以延长' });
  }

  // 计算新的过期时间
  const currentExpiry = new Date(request.activation_expires_at || Date.now());
  const newExpiry = new Date(currentExpiry.getTime() + days * 24 * 60 * 60 * 1000);

  db.updateJoinRequest(requestId, {
    activation_expires_at: db.formatShanghaiTime(newExpiry)
  });

  res.json({
    success: true,
    message: `激活窗口已延长 ${days} 天`,
    new_expires_at: db.formatShanghaiTime(newExpiry)
  });
});

// DELETE /api/admin/agents/:id - 删除 Agent
router.delete('/agents/:id', (req, res) => {
  const { id: agentId } = req.params;

  // 断开该 Agent 的连接
  agentManager.disconnectAgent(agentId);

  // 删除所有相关数据
  const result = db.deleteAgent(agentId);

  if (result.success) {
    // 广播下线状态
    chat.broadcast('agent_status', {
      agent_id: agentId,
      name: result.deletedAgent?.name || agentId,
      status: 'offline',
      deleted: true
    });

    res.json({
      success: true,
      message: `Agent "${result.deletedAgent?.name || agentId}" 已删除`
    });
  } else {
    res.status(404).json({ success: false, error: 'Agent 不存在' });
  }
});

module.exports = router;