/**
 * Agent Manager - 管理 Agent 的连接、状态和消息
 *
 * 接入协议: join_request -> 管理员审核 -> activation_ready
 */

const db = require('./database');
const chat = require('./chat');
const protocol = require('./protocol');
const { traceStore, EVENT_TYPES } = require('./trace-store');

// 存储已连接的Agent
const connectedAgents = new Map();

// 待审核的连接 { requestId: { ws, request } }
const pendingConnections = new Map();

// 心跳超时
const HEARTBEAT_TIMEOUT = 60000;

const agentManager = {
  // ==================== 新协议处理 ====================

  /**
   * 处理新的接入申请 (join_request)
   */
  handleJoinRequest(ws, payload) {
    const result = protocol.handleJoinRequest(ws, payload, pendingConnections, connectedAgents);

    // 如果需要使用快速通道（已注册的 Agent）
    if (result.useFastTrack) {
      return this.approveAgentConnection(ws, result.existingConfig);
    }

    return result;
  },

  /**
   * 处理激活就绪 (activation_ready)
   */
  handleActivationReady(ws, payload) {
    return protocol.handleActivationReady(
      ws,
      payload,
      pendingConnections,
      connectedAgents,
      {
        onActivated: (request, config) => {
          // 广播上线状态
          chat.broadcast('agent_status', {
            agent_id: config.id,
            name: config.name,
            status: 'online'
          });

          // 通知在线 Agent 更新成员列表
          this.broadcastParticipantsUpdate();
        }
      }
    );
  },

  /**
   * 批准接入申请 (管理员操作)
   */
  approveJoinRequest(requestId, platformConfig, approvedBy) {
    // 获取申请信息
    const request = db.getJoinRequestById(requestId);
    if (!request) {
      return { success: false, error: '申请不存在' };
    }

    if (request.status !== protocol.REQUEST_STATUS.PENDING) {
      return { success: false, error: '申请状态不正确' };
    }

    // 获取待审核连接
    const pending = pendingConnections.get(requestId);
    if (!pending || !protocol.isConnectionAlive(pending.ws)) {
      return { success: false, error: '连接已断开，请重新连接' };
    }

    // 生成连接密钥
    const connectionSecret = require('crypto').randomBytes(32).toString('hex');
    const activationExpiresAt = db.formatShanghaiTime(
      new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7天激活窗口
    );

    // 更新数据库
    const displayName = platformConfig.display_name || request.proposed_name;
    db.approveJoinRequest(requestId, approvedBy, {
      display_name: displayName,
      target_room: platformConfig.target_room || 'main',
      receive_mode: platformConfig.receive_mode || 'free',
      capability_scope: platformConfig.capability_scope || protocol.PLATFORM_CAPABILITIES,
      notes: platformConfig.notes || '',
      connection_secret: connectionSecret,
      activation_expires_at: activationExpiresAt
    });

    // 发送审核通过通知
    protocol.sendJoinApproved(pending.ws, { ...request, display_name: displayName }, {
      display_name: displayName,
      target_room: platformConfig.target_room || 'main',
      receive_mode: platformConfig.receive_mode || 'free',
      capability_scope: platformConfig.capability_scope || protocol.PLATFORM_CAPABILITIES,
      notes: platformConfig.notes || '',
      connection_secret: connectionSecret,
      activation_expires_at: activationExpiresAt
    });

    // 广播通知
    chat.broadcast('system', {
      type: 'join_request_approved',
      message: `✅ Agent "${displayName}" 的接入申请已通过，等待激活`
    });

    console.log(`[Agent] 接入申请已批准: ${displayName} (${requestId})`);

    return { success: true, displayName };
  },

  /**
   * 拒绝接入申请 (管理员操作)
   */
  rejectJoinRequest(requestId, reason, rejectedBy) {
    const request = db.getJoinRequestById(requestId);
    if (!request) {
      return { success: false, error: '申请不存在' };
    }

    // 获取待审核连接
    const pending = pendingConnections.get(requestId);
    if (pending && protocol.isConnectionAlive(pending.ws)) {
      protocol.sendJoinRejected(pending.ws, requestId, reason);
    }

    // 更新数据库
    db.rejectJoinRequest(requestId, reason);

    // 移除待审核连接
    pendingConnections.delete(requestId);

    console.log(`[Agent] 接入申请已拒绝: ${request.proposed_name} (${requestId}) - ${reason}`);

    return { success: true };
  },

  /**
   * 获取所有待审核的接入申请
   */
  getPendingJoinRequests() {
    return db.getJoinRequestsByStatus(protocol.REQUEST_STATUS.PENDING);
  },

  /**
   * 获取所有接入申请（包含各状态）
   */
  getAllJoinRequests() {
    return db.getAllJoinRequests();
  },

  /**
   * 获取单个接入申请详情
   */
  getJoinRequestById(requestId) {
    return db.getJoinRequestById(requestId);
  },

  // ==================== 通用方法 ====================

  /**
   * 批准Agent连接（快速重连）
   */
  approveAgentConnection(ws, agentConfig) {
    const agent_id = agentConfig.id;
    const request_id = agentConfig.request_id;

    if (connectedAgents.has(agent_id)) {
      const existing = connectedAgents.get(agent_id);
      if (existing.ws && existing.ws.readyState === 1) {
        console.log(`[Agent] ${agentConfig.name} 尝试重复连接，已拒绝`);
        return { success: false, error: '该 Agent 已在线，请使用不同的 ID' };
      }
      connectedAgents.delete(agent_id);
    }

    console.log(`[Agent] ${agentConfig.name} 快速重连成功`);

    connectedAgents.set(agent_id, {
      ws,
      config: agentConfig,
      lastPing: Date.now()
    });

    // 使用新协议发送激活成功消息
    ws.send(JSON.stringify({
      type: 'join_ack',
      payload: {
        request_id: request_id,
        status: 'active',
        platform_id: 'agent-chat-v2',
        activated_at: db.formatShanghaiTime(new Date())
      }
    }));

    // 发送平台信息
    const onlineUsers = chat.getOnlineUsers();
    const allAgents = db.getAllAgents().map(a => ({
      id: a.id,
      name: a.name,
      type: 'agent'
    }));

    ws.send(JSON.stringify({
      type: 'platform_info',
      payload: {
        platform_id: 'agent-chat-v2',
        platform_name: 'Agent Chat',
        protocol_version: '2.0',
        your_name: agentConfig.name,
        your_id: agent_id,
        capabilities: {
          text: true,
          image: false,
          file: false,
          threads: false,
          message_edit: false,
          message_revoke: false,
          history_read: true
        }
      }
    }));

    // 发送成员列表
    ws.send(JSON.stringify({
      type: 'participants_sync',
      payload: {
        room_id: 'main',
        participants: [
          ...onlineUsers.map(u => ({
            participant_id: u.session_id,
            display_name: u.display_name || u.username,
            type: 'human',
            status: 'online'
          })),
          ...allAgents.map(a => ({
            participant_id: a.id,
            display_name: a.name,
            type: 'agent',
            status: connectedAgents.has(a.id) ? 'online' : 'offline'
          }))
        ],
        synced_at: db.formatShanghaiTime(new Date())
      }
    }));

    // 发送历史消息
    const history = chat.getHistory(50);
    ws.send(JSON.stringify({
      type: 'history_sync',
      payload: {
        room_id: 'main',
        messages: history.map(m => ({
          message_id: m.id,
          sender_id: m.sender_id,
          sender_name: m.sender_name,
          sender_type: m.sender_type,
          content: m.content,
          created_at: m.created_at
        })),
        has_more: false,
        synced_at: db.formatShanghaiTime(new Date())
      }
    }));

    chat.broadcast('agent_status', {
      agent_id: agentConfig.id,
      name: agentConfig.name,
      status: 'online'
    });

    this.setupAgentMessageHandler(ws, agentConfig);

    return { success: true, agentConfig };
  },

  /**
   * 发送欢迎消息
   */
  sendWelcomeMessage(ws, config) {
    // 1. 确认连接
    ws.send(JSON.stringify({
      type: 'agent_join_ack',
      payload: {
        agent_id: config.id,
        agent_name: config.name,
        protocol_version: '2.1'
      }
    }));

    // 2. 平台信息
    const onlineUsers = chat.getOnlineUsers();
    const allAgents = db.getAllAgents().map(a => ({
      id: a.id,
      name: a.name,
      type: 'agent'
    }));

    ws.send(JSON.stringify({
      type: 'platform',
      payload: {
        platform_id: 'agent-chat-v1',
        platform_name: 'Agent Chat',
        your_name: config.name,
        your_id: config.id,
        participants: {
          users: onlineUsers.map(u => ({ name: u.display_name || u.username, type: 'human' })),
          agents: allAgents
        },
        rules: {
          mode: 'free_chat',
          you_can: [
            '自由回复任何消息',
            '与其他Agent连续对话',
            '主动发起话题'
          ],
          note: '这是群聊，消息会广播给所有人'
        }
      }
    }));

    // 3. 历史消息
    const history = chat.getHistory(config.history_limit || 50);
    ws.send(JSON.stringify({
      type: 'history',
      payload: { messages: history }
    }));
  },

  /**
   * 消息处理
   */
  setupAgentMessageHandler(ws, config) {
    ws.on('close', () => {
      console.log(`[Agent] ${config.name} 断开`);
      connectedAgents.delete(config.id);
      chat.broadcast('agent_status', {
        agent_id: config.id,
        name: config.name,
        status: 'offline'
      });
    });

    ws.on('error', (err) => {
      console.error(`[Agent] ${config.name} 错误:`, err.message);
      connectedAgents.delete(config.id);
    });
  },

  /**
   * 处理Agent消息
   */
  handleAgentMessage(config, msg) {
    if (msg.type === 'pong') {
      const agent = connectedAgents.get(config.id);
      if (agent) agent.lastPing = Date.now();
      return;
    }

    if (msg.type === 'message' && msg.payload?.content) {
      const message = chat.handleAgentMessage(
        config.id,
        config.name,
        msg.payload.content
      );

      if (message) {
        chat.broadcast('message', message);

        for (const [agentId, agent] of connectedAgents) {
          if (agentId === config.id) continue;
          if (agent.ws.readyState !== 1) continue;

          agent.ws.send(JSON.stringify({
            type: 'message',
            payload: {
              ...message,
              _platform: 'agent-chat-v1'
            }
          }));
        }
      }
    }
  },

  /**
   * 转发消息给Agent
   */
  forwardToAgents(message) {
    const agentCount = connectedAgents.size;

    // 记录转发事件（如果有 trace_id）
    if (message && message.trace_id) {
      traceStore.addEvent(message.trace_id, EVENT_TYPES.SERVER_FORWARD_AGENT, {
        agent_count: agentCount,
        message_id: message.id
      });
    }

    for (const [, agent] of connectedAgents) {
      if (agent.ws.readyState !== 1) continue;

      agent.ws.send(JSON.stringify({
        type: 'message',
        payload: {
          ...message,
          _platform: 'agent-chat-v1'
        }
      }));
    }
  },

  /**
   * 心跳检测
   */
  pingAllAgents() {
    this.cleanExpiredPending();

    // 清理过期的新协议申请
    const expiredResult = db.cleanExpiredJoinRequests();
    if (expiredResult.expired > 0) {
      console.log(`[Agent] 清理了 ${expiredResult.expired} 个过期的接入申请`);
    }

    for (const [agentId, agent] of connectedAgents) {
      if (agent.ws.readyState !== 1) continue;

      if (Date.now() - agent.lastPing > HEARTBEAT_TIMEOUT) {
        console.log(`[Agent] ${agent.config.name} 超时断开`);
        agent.ws.terminate();
        connectedAgents.delete(agentId);
        continue;
      }

      agent.ws.send(JSON.stringify({ type: 'ping' }));
    }
  },

  /**
   * 清理过期的待审核请求
   */
  cleanExpiredPending() {
    const now = Date.now();
    const PENDING_TIMEOUT = 24 * 60 * 60 * 1000; // 24小时

    for (const [requestId, pending] of pendingConnections) {
      // 只清理 pending 状态的请求
      if (pending.request && pending.request.status !== 'pending') continue;

      const submittedAt = new Date(pending.request?.submitted_at || pending.connectedAt).getTime();
      if (now - submittedAt > PENDING_TIMEOUT) {
        if (pending.ws && pending.ws.readyState === 1) {
          pending.ws.send(JSON.stringify({
            type: 'join_rejected',
            payload: { request_id: requestId, status: 'rejected', reason: '审核超时，请重新连接' }
          }));
          pending.ws.close();
        }
        pendingConnections.delete(requestId);
        console.log(`[Agent] 待审核请求已过期: ${pending.request?.proposed_name || requestId}`);
      }
    }
  },

  getAgentStatus() {
    return db.getAllAgents().map(agent => ({
      id: agent.id,
      name: agent.name,
      status: connectedAgents.has(agent.id) ? 'online' : 'offline'
    }));
  },

  getOnlineCount() {
    return connectedAgents.size;
  },

  notifySettingsChanged() {
    console.log('[Agent] 设置已更新');
  },

  notifyAgentConfigChanged(agentId) {
    const agent = connectedAgents.get(agentId);
    if (agent && agent.ws.readyState === 1) {
      const fullConfig = db.getAgentFullConfig(agentId);
      if (fullConfig) {
        agent.ws.send(JSON.stringify({
          type: 'config_update',
          payload: {
            agent_id: agentId,
            name: fullConfig.name,
            persona: fullConfig.persona || '',
            conversation_mode: fullConfig.conversation_mode || 'free',
            custom_settings: fullConfig.custom_settings || {},
            history_limit: fullConfig.history_limit || 50,
            message_filter: fullConfig.message_filter || 'all',
            keywords: fullConfig.keywords || []
          }
        }));
        console.log(`[Agent] 已通知 ${fullConfig.name} 配置更新`);
      }
    }
  },

  broadcastParticipantsUpdate() {
    const onlineUsers = chat.getOnlineUsers();
    const allAgents = db.getAllAgents().map(a => ({
      id: a.id,
      name: a.name,
      type: 'agent'
    }));

    for (const [, agent] of connectedAgents) {
      if (agent.ws.readyState !== 1) continue;

      agent.ws.send(JSON.stringify({
        type: 'participants_update',
        payload: {
          users: onlineUsers.map(u => ({ name: u.display_name || u.username, type: 'human' })),
          agents: allAgents
        }
      }));
    }
  },

  broadcastClearHistory() {
    for (const [, agent] of connectedAgents) {
      if (agent.ws.readyState !== 1) continue;
      agent.ws.send(JSON.stringify({ type: 'clear_history' }));
    }
    console.log('[Agent] 已通知所有Agent清空历史');
  },

  // 断开指定 Agent 的连接
  disconnectAgent(agentId) {
    const agent = connectedAgents.get(agentId);
    if (agent && agent.ws.readyState === 1) {
      // 发送下线通知
      agent.ws.send(JSON.stringify({
        type: 'join_revoked',
        payload: {
          reason: '已被管理员删除',
          revoked_at: db.formatShanghaiTime(new Date())
        }
      }));
      // 关闭连接
      agent.ws.close();
      connectedAgents.delete(agentId);
      console.log(`[Agent] 已断开 ${agentId} 的连接`);
      return true;
    }

    // 检查待审核连接
    for (const [requestId, pending] of pendingConnections) {
      if (pending.request.agent_id === agentId) {
        pending.ws.close();
        pendingConnections.delete(requestId);
        console.log(`[Agent] 已断开待审核的 ${agentId} 连接`);
        return true;
      }
    }

    return false;
  },

  // ==================== 话题总结相关 ====================

  requestTopicSummary(topicId, topicTitle, messages) {
    let targetAgent = null;
    for (const [, agent] of connectedAgents) {
      if (agent.ws.readyState === 1) {
        targetAgent = agent;
        break;
      }
    }

    if (!targetAgent) {
      console.log('[Agent] 没有在线的Agent可用于生成总结');
      return { success: false, error: '没有在线的Agent' };
    }

    console.log(`[Agent] 请求 ${targetAgent.config.name} 生成话题总结: ${topicTitle}`);

    targetAgent.ws.send(JSON.stringify({
      type: 'summary_request',
      payload: {
        topic_id: topicId,
        topic_title: topicTitle,
        messages: messages.map(m => ({
          sender_name: m.sender_name,
          sender_type: m.sender_type,
          content: m.content,
          time: m.original_created_at
        })),
        request_type: 'generate_summary',
        instructions: `请为这个话题生成一个结构化的总结，包括：
1. narrative: 用自然语言叙述这个讨论的来龙去脉
2. viewpoints: 每个参与者（人和Agent）的主要观点
3. consensus: 大家达成的共识（如果有）
4. open_questions: 还没解决的问题（如果有）

请用JSON格式返回。`
      }
    }));

    return { success: true, agentName: targetAgent.config.name };
  },

  handleSummaryResponse(msg) {
    const { topic_id, summary } = msg.payload || {};

    if (!topic_id || !summary) {
      console.log('[Agent] 收到无效的总结响应');
      return;
    }

    console.log(`[Agent] 收到话题总结: ${topic_id}`);

    const saved = db.saveTopicSummary(
      topic_id,
      summary.narrative || '',
      summary.viewpoints || [],
      summary.consensus || '',
      summary.open_questions || []
    );

    chat.broadcast('topic_summary_ready', {
      topic_id,
      summary: saved
    });

    return saved;
  },

  getFirstOnlineAgent() {
    for (const [, agent] of connectedAgents) {
      if (agent.ws.readyState === 1) {
        return agent;
      }
    }
    return null;
  },

  /**
   * 发送消息给特定 Agent
   * @param {string} agentId - Agent ID
   * @param {Object} message - 消息对象
   * @returns {boolean} 是否发送成功
   */
  sendToAgent(agentId, message) {
    const agent = connectedAgents.get(agentId);
    if (!agent || agent.ws.readyState !== 1) {
      return false;
    }

    try {
      agent.ws.send(JSON.stringify(message));
      return true;
    } catch (err) {
      console.error(`[Agent] 发送消息给 ${agentId} 失败:`, err.message);
      return false;
    }
  },

  /**
   * 广播消息给所有在线 Agent
   * @param {Object} message - 消息对象
   */
  broadcastToAgents(message) {
    const messageStr = JSON.stringify(message);
    for (const [agentId, agent] of connectedAgents) {
      if (agent.ws.readyState === 1) {
        try {
          agent.ws.send(messageStr);
        } catch (err) {
          console.error(`[Agent] 广播给 ${agentId} 失败:`, err.message);
        }
      }
    }
  },

  // ==================== 暴露给 protocol 模块 ====================

  getConnectedAgents() {
    return connectedAgents;
  },

  getPendingConnections() {
    return pendingConnections;
  }
};

module.exports = agentManager;
