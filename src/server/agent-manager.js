const db = require('./database');
const chat = require('./chat');

// 存储已连接的Agent
const connectedAgents = new Map();

// 心跳超时
const HEARTBEAT_TIMEOUT = 60000;

// Agent管理器（极简版本）
const agentManager = {
  // 处理Agent连接
  handleAgentConnection(ws, initialMsg) {
    const { agent_id, token } = initialMsg.payload || {};

    if (!agent_id || !token) {
      return { success: false, error: '缺少agent_id或token' };
    }

    const agentConfig = db.getAgentByToken(token);
    if (!agentConfig) {
      return { success: false, error: '无效的token' };
    }

    if (agentConfig.id !== agent_id) {
      return { success: false, error: 'agent_id与token不匹配' };
    }

    // 断开旧连接
    if (connectedAgents.has(agent_id)) {
      const existing = connectedAgents.get(agent_id);
      if (existing.ws && existing.ws.readyState === 1) {
        existing.ws.close();
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
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        this.handleAgentMessage(config, msg);
      } catch (e) {
        console.error(`[Agent] ${config.name} 解析失败:`, e.message);
      }
    });

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
  }
};

module.exports = agentManager;
