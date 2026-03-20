const db = require('./database');
const chat = require('./chat');

// 存储已连接的Agent（反向连接模式）
// Map<agentId, { ws, config, connected, lastPing }>
const connectedAgents = new Map();

// 冷却时间配置（方案B）
const AGENT_COOLDOWN_MS = 10000; // 10秒冷却
const agentLastReply = new Map(); // agentId -> timestamp

// 连续消息限制
const MAX_CONSECUTIVE_MSG = 3;
let consecutiveMsgCount = 0;
let lastMsgTime = 0;

// 心跳超时
const HEARTBEAT_TIMEOUT = 60000;

// Agent管理器（反向连接模式）
const agentManager = {
  // 处理Agent连接（由websocket.js调用）
  handleAgentConnection(ws, initialMsg) {
    const { agent_id, token } = initialMsg.payload || {};

    if (!agent_id || !token) {
      return { success: false, error: '缺少agent_id或token' };
    }

    // 验证token
    const agentConfig = db.getAgentByToken(token);
    if (!agentConfig) {
      return { success: false, error: '无效的token' };
    }

    if (agentConfig.id !== agent_id) {
      return { success: false, error: 'agent_id与token不匹配' };
    }

    // 检查是否已连接
    if (connectedAgents.has(agent_id)) {
      const existing = connectedAgents.get(agent_id);
      if (existing.ws && existing.ws.readyState === 1) {
        existing.ws.close();
      }
      connectedAgents.delete(agent_id);
    }

    console.log(`[Agent] ${agentConfig.name} 已连接 (反向连接模式)`);

    // 注册Agent
    connectedAgents.set(agent_id, {
      ws,
      config: agentConfig,
      connected: true,
      lastPing: Date.now()
    });

    // 发送欢迎消息（包含行为指南）
    this.sendWelcomeMessage(ws, agentConfig);

    // 广播Agent上线
    chat.broadcast('agent_status', {
      agent_id: agentConfig.id,
      name: agentConfig.name,
      status: 'online'
    });

    // 设置消息处理
    this.setupAgentMessageHandler(ws, agentConfig);

    return { success: true, agentConfig };
  },

  // 发送欢迎消息
  sendWelcomeMessage(ws, config) {
    // 发送注册成功确认
    ws.send(JSON.stringify({
      type: 'agent_join_ack',
      payload: {
        agent_id: config.id,
        agent_name: config.name,
        status: 'ready',
        protocol_version: '2.0'
      }
    }));

    // 发送平台信息
    ws.send(JSON.stringify({
      type: 'platform',
      payload: {
        type: 'multi_agent_group_chat',
        description: '这是一个多人多Agent群聊平台，不是传统的1对1问答系统',
        features: [
          '多人+多Agent同时在线',
          '所有消息实时广播给所有参与者',
          '支持@提及指定回复对象',
          '消息来源可能是人类或其他Agent'
        ],
        your_role: '群聊中的AI成员，不是用户的专属1对1助手',
        // 行为指南 - 引导Agent合理参与对话
        behavior_guide: {
          summary: '你是一个群聊中的AI助手，请遵循以下原则参与对话',
          reply_principles: [
            '只回复与你相关或你能提供独特价值的消息',
            '被@提及时应该回复',
            '用户直接向你提问时应该回复',
            '其他Agent已经给出了满意回答时，无需重复回复',
            '避免与问候语、表情包等无关内容互动'
          ],
          user_authorization: {
            description: '用户可以通过特定方式授权Agent持续对话',
            auth_keywords: ['继续', '请继续', 'go on', 'continue', '/allow-chat'],
            when_authorized: '用户授权后，你可以与其他Agent自由对话，无需担心循环限制'
          },
          avoid_loops: [
            '默认情况下，不要回复每一条消息',
            '如果最近已有Agent回复了类似内容，不要重复',
            '看到消息后先思考：这个消息真的需要我回复吗？'
          ],
          timing: {
            suggest_delay_ms: 1500,
            max_delay_ms: 5000,
            reason: '添加1.5-5秒随机延时，模拟人类思考时间，避免消息刷屏'
          },
          context: {
            group_name: 'Agent Chat',
            participant_count: '多个人类用户和多个AI助手'
          }
        }
      }
    }));

    // 发送历史消息
    const history = chat.getHistory(config.history_limit || 50);
    ws.send(JSON.stringify({
      type: 'history',
      payload: {
        messages: history
      }
    }));
  },

  // 设置Agent消息处理器
  setupAgentMessageHandler(ws, config) {
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        this.handleAgentMessage(config, msg);
      } catch (e) {
        console.error(`[Agent] ${config.name} 解析消息失败:`, e.message);
      }
    });

    ws.on('close', () => {
      console.log(`[Agent] ${config.name} 断开连接`);
      connectedAgents.delete(config.id);

      // 广播Agent离线
      chat.broadcast('agent_status', {
        agent_id: config.id,
        name: config.name,
        status: 'offline'
      });
    });

    ws.on('error', (err) => {
      console.error(`[Agent] ${config.name} 连接错误:`, err.message);
      connectedAgents.delete(config.id);
    });
  },

  // 处理Agent发送的消息
  handleAgentMessage(config, msg) {
    // 处理心跳响应
    if (msg.type === 'pong') {
      const agent = connectedAgents.get(config.id);
      if (agent) {
        agent.lastPing = Date.now();
      }
      return;
    }

    if (msg.type === 'message' && msg.payload?.content) {
      // 检查冷却时间（方案B）
      const lastReply = agentLastReply.get(config.id) || 0;
      if (Date.now() - lastReply < AGENT_COOLDOWN_MS) {
        console.log(`[Agent] ${config.name} 冷却中，跳过`);
        return;
      }

      // 检查连续消息限制
      const now = Date.now();
      if (now - lastMsgTime < 5000) {
        consecutiveMsgCount++;
        if (consecutiveMsgCount > MAX_CONSECUTIVE_MSG) {
          console.log(`[Agent] ${config.name} 连续消息过多，阻止`);
          consecutiveMsgCount = 0;
          return;
        }
      } else {
        consecutiveMsgCount = 1;
      }
      lastMsgTime = now;

      const message = chat.handleAgentMessage(
        config.id,
        config.name,
        msg.payload.content
      );

      if (message) {
        // 记录回复时间
        agentLastReply.set(config.id, Date.now());
        chat.broadcast('message', message);
      }
    }
  },

  // 向Agent转发消息
  forwardToAgents(message) {
    for (const [, agent] of connectedAgents) {
      if (!agent.connected || agent.ws.readyState !== 1) continue;

      const config = agent.config;
      let shouldForward = false;

      switch (config.message_filter) {
        case 'all':
          shouldForward = true;
          break;

        case 'mention':
          // 检查是否@了Agent
          const mentionPattern = new RegExp(`@${config.name}`, 'i');
          shouldForward = mentionPattern.test(message.content);
          break;

        case 'keywords':
          // 检查是否包含关键词
          if (config.keywords) {
            try {
              const keywords = JSON.parse(config.keywords);
              shouldForward = keywords.some(kw =>
                message.content.toLowerCase().includes(kw.toLowerCase())
              );
            } catch (e) {
              console.error(`[Agent] 解析关键词失败:`, e.message);
            }
          }
          break;
      }

      if (shouldForward) {
        agent.ws.send(JSON.stringify({
          type: 'message',
          payload: message
        }));
      }
    }
  },

  // 发送ping给所有Agent
  pingAllAgents() {
    for (const [agentId, agent] of connectedAgents) {
      if (agent.ws.readyState !== 1) continue;

      // 检查心跳超时
      if (Date.now() - agent.lastPing > HEARTBEAT_TIMEOUT) {
        console.error(`[Agent] ${agent.config.name} 心跳超时，断开连接`);
        agent.ws.terminate();
        connectedAgents.delete(agentId);

        chat.broadcast('agent_status', {
          agent_id: agentId,
          name: agent.config.name,
          status: 'offline'
        });
        continue;
      }

      agent.ws.send(JSON.stringify({ type: 'ping' }));
    }
  },

  // 获取所有Agent状态
  getAgentStatus() {
    const agents = db.getAllAgents();
    return agents.map(agent => ({
      id: agent.id,
      name: agent.name,
      avatar_url: agent.avatar_url,
      status: connectedAgents.has(agent.id) ? 'online' : 'offline'
    }));
  },

  // 获取在线Agent数量
  getOnlineCount() {
    return connectedAgents.size;
  }
};

module.exports = agentManager;
