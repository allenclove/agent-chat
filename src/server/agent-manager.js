const db = require('./database');
const chat = require('./chat');
const crypto = require('crypto');

// 存储已连接的Agent
const connectedAgents = new Map();

// 待审核的Agent请求 { agentId: { ws, name, token, code, timestamp } }
const pendingAgents = new Map();

// 心跳超时
const HEARTBEAT_TIMEOUT = 60000;

// 审核码有效期（5分钟）
const PENDING_TIMEOUT = 5 * 60 * 1000;

// Agent管理器（极简版本）
const agentManager = {
  // 处理Agent连接
  handleAgentConnection(ws, initialMsg) {
    const { agent_id, token, name } = initialMsg.payload || {};

    if (!agent_id || !token) {
      return { success: false, error: '缺少agent_id或token' };
    }

    // 先检查是否是已注册的Agent
    const agentConfig = db.getAgentByToken(token);
    if (agentConfig) {
      if (agentConfig.id !== agent_id) {
        return { success: false, error: 'agent_id与token不匹配' };
      }
      return this.approveAgentConnection(ws, agentConfig);
    }

    // 未注册的Agent - 进入快速匹配流程
    // 检查是否已有待审核的请求
    const existing = pendingAgents.get(agent_id);
    if (existing && existing.ws === ws) {
      return { success: false, error: '等待审核中', pending: true };
    }

    // 生成审核码（4位数字）
    const code = crypto.randomInt(1000, 9999).toString();
    const agentName = name || agent_id;

    // 存储待审核请求
    pendingAgents.set(agent_id, {
      ws,
      name: agentName,
      token,
      code,
      timestamp: Date.now()
    });

    console.log(`[Agent] 新Agent请求接入: ${agentName} (审核码: ${code})`);

    // 通知所有用户有新Agent请求接入
    chat.broadcast('agent_join_request', {
      agent_id,
      name: agentName,
      code,
      message: `🤖 新Agent "${agentName}" 请求加入群聊\n在聊天框输入 /accept ${code} 批准接入`
    });

    // 发送等待消息给Agent
    ws.send(JSON.stringify({
      type: 'agent_join_pending',
      payload: {
        message: '等待管理员审核...请在群聊中发送审核码',
        code
      }
    }));

    return { success: false, error: '等待审核', pending: true, code };
  },

  // 批准Agent连接
  approveAgentConnection(ws, agentConfig) {
    const agent_id = agentConfig.id;

    // 已有连接则拒绝新的（保护在线Agent）
    if (connectedAgents.has(agent_id)) {
      const existing = connectedAgents.get(agent_id);
      if (existing.ws && existing.ws.readyState === 1) {
        console.log(`[Agent] ${agentConfig.name} 尝试重复连接，已拒绝`);
        return { success: false, error: '该 Agent 已在线，请使用不同的 ID' };
      }
      connectedAgents.delete(agent_id);
    }

    console.log(`[Agent] ${agentConfig.name} 已连接`);

    connectedAgents.set(agent_id, {
      ws,
      config: agentConfig,
      lastPing: Date.now()
    });

    // 发送欢迎消息
    this.sendWelcomeMessage(ws, agentConfig);

    // 广播上线
    chat.broadcast('agent_status', {
      agent_id: agentConfig.id,
      name: agentConfig.name,
      status: 'online'
    });

    // 设置消息处理
    this.setupAgentMessageHandler(ws, agentConfig);

    return { success: true, agentConfig };
  },

  // 通过审核码批准Agent
  approveAgentByCode(code) {
    for (const [agentId, pending] of pendingAgents) {
      if (pending.code === code) {
        // 检查连接是否还活着
        if (pending.ws.readyState !== 1) {
          pendingAgents.delete(agentId);
          return { success: false, error: 'Agent连接已断开，请重新连接' };
        }

        // 注册Agent到数据库
        const agentConfig = {
          id: agentId,
          name: pending.name,
          token: pending.token
        };
        db.addAgent(agentConfig);

        // 从待审核列表移除
        pendingAgents.delete(agentId);

        // 批准连接
        const result = this.approveAgentConnection(pending.ws, {
          id: agentId,
          name: pending.name,
          token: pending.token
        });

        // 通知所有用户
        chat.broadcast('system', {
          type: 'agent_approved',
          message: `✅ Agent "${pending.name}" 已成功加入群聊`
        });

        // 通知在线Agent更新成员列表
        this.broadcastParticipantsUpdate();

        return { success: true, agentName: pending.name };
      }
    }
    return { success: false, error: '无效的审核码' };
  },

  // 获取待审核的Agent列表
  getPendingAgents() {
    const list = [];
    for (const [agentId, pending] of pendingAgents) {
      list.push({
        agent_id: agentId,
        name: pending.name,
        code: pending.code,
        timestamp: pending.timestamp
      });
    }
    return list;
  },

  // 清理过期的待审核请求
  cleanExpiredPending() {
    const now = Date.now();
    for (const [agentId, pending] of pendingAgents) {
      if (now - pending.timestamp > PENDING_TIMEOUT) {
        if (pending.ws.readyState === 1) {
          pending.ws.send(JSON.stringify({
            type: 'agent_join_error',
            payload: { error: '审核超时，请重新连接' }
          }));
          pending.ws.close();
        }
        pendingAgents.delete(agentId);
        console.log(`[Agent] 待审核请求已过期: ${pending.name}`);
      }
    }
  },

  // 发送欢迎消息（极简版）
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

    // 2. 平台信息（极简）
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

        // 群成员
        participants: {
          users: onlineUsers.map(u => ({ name: u.display_name || u.username, type: 'human' })),
          agents: allAgents
        },

        // 极简规则
        rules: {
          mode: 'free_chat',  // 自由聊天模式
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

  // 消息处理
  setupAgentMessageHandler(ws, config) {
    // 注意：消息处理已在 websocket.js 中的 ws.on('message', ...) 中完成
    // 这里只处理 close 和 error 事件，避免重复处理消息

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

  // 处理Agent消息（极简版 - 无限制）
  handleAgentMessage(config, msg) {
    if (msg.type === 'pong') {
      const agent = connectedAgents.get(config.id);
      if (agent) agent.lastPing = Date.now();
      return;
    }

    if (msg.type === 'message' && msg.payload?.content) {
      // 直接处理消息，无冷却限制
      const message = chat.handleAgentMessage(
        config.id,
        config.name,
        msg.payload.content
      );

      if (message) {
        // 广播给所有人
        chat.broadcast('message', message);

        // 转发给其他Agent（带上平台标识）
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

  // 转发消息给Agent（极简版 - 无过滤）
  forwardToAgents(message) {
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

  // 心跳
  pingAllAgents() {
    // 清理过期的待审核请求
    this.cleanExpiredPending();

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

  // 热更新（极简版）
  notifySettingsChanged() {
    console.log('[Agent] 设置已更新');
  },

  // 广播成员列表更新给所有Agent
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

  // 广播清空历史消息给所有Agent
  broadcastClearHistory() {
    for (const [, agent] of connectedAgents) {
      if (agent.ws.readyState !== 1) continue;
      agent.ws.send(JSON.stringify({ type: 'clear_history' }));
    }
    console.log('[Agent] 已通知所有Agent清空历史');
  }
};

module.exports = agentManager;
