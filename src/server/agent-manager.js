const WebSocket = require('ws');
const db = require('./database');
const chat = require('./chat');

// 存储已连接的Agent
// Map<agentId, { ws, config, connected, lastPing }>
const connectedAgents = new Map();

// 握手超时时间（毫秒）
const HANDSHAKE_TIMEOUT = 5000;
const HEARTBEAT_INTERVAL = 30000;
const HEARTBEAT_TIMEOUT = 60000;

// Agent管理器
const agentManager = {
  // 连接所有配置的Agent
  async connectAll() {
    const agents = db.getAllAgents();
    for (const agent of agents) {
      await this.connectAgent(agent);
    }
  },

  // 连接单个Agent
  connectAgent(config) {
    return new Promise((resolve) => {
      if (connectedAgents.has(config.id)) {
        resolve(true);
        return;
      }

      console.log(`[Agent] 连接 ${config.name} (${config.websocket_url})...`);

      const ws = new WebSocket(config.websocket_url);
      let handshakeComplete = false;
      let heartbeatTimer = null;
      let lastPing = Date.now();

      // 握手超时
      const handshakeTimer = setTimeout(() => {
        if (!handshakeComplete) {
          console.error(`[Agent] ${config.name} 握手超时，断开连接`);
          ws.terminate();
          resolve(false);
        }
      }, HANDSHAKE_TIMEOUT);

      ws.on('open', () => {
        console.log(`[Agent] ${config.name} WebSocket已连接，等待握手...`);

        // 发送join消息（包含协议版本和行为指南）
        ws.send(JSON.stringify({
          type: 'join',
          payload: {
            agent_id: config.id,
            agent_name: config.name,
            protocol_version: '1.0',
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
              avoid_loops: [
                '不要回复每一条消息',
                '如果最近已有Agent回复了类似内容，不要重复',
                '避免与其他Agent连续对话超过2轮',
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
      });

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());

          // 处理握手响应
          if (!handshakeComplete && msg.type === 'join_ack') {
            handshakeComplete = true;
            clearTimeout(handshakeTimer);

            console.log(`[Agent] ${config.name} 握手成功，已连接`);

            connectedAgents.set(config.id, {
              ws,
              config,
              connected: true,
              lastPing: Date.now()
            });

            // 广播Agent上线
            chat.broadcast('agent_status', {
              agent_id: config.id,
              name: config.name,
              status: 'online'
            });

            // 启动心跳检测
            startHeartbeat(config.id);

            resolve(true);
            return;
          }

          // 处理心跳响应
          if (msg.type === 'pong') {
            const agent = connectedAgents.get(config.id);
            if (agent) {
              agent.lastPing = Date.now();
            }
            return;
          }

          // 处理普通消息
          this.handleAgentMessage(config, msg);
        } catch (e) {
          console.error(`[Agent] 解析消息失败:`, e.message);
        }
      });

      ws.on('close', () => {
        console.log(`[Agent] ${config.name} 断开连接`);
        connectedAgents.delete(config.id);
        clearHeartbeat(config.id);

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
        clearTimeout(handshakeTimer);
        clearHeartbeat(config.id);
        resolve(false);
      });

      // 连接超时
      setTimeout(() => {
        if (!connectedAgents.has(config.id)) {
          ws.terminate();
          console.error(`[Agent] ${config.name} 连接超时`);
          resolve(false);
        }
      }, HANDSHAKE_TIMEOUT);
    });
  },

  // 处理Agent发送的消息
  handleAgentMessage(config, msg) {
    if (msg.type === 'message' && msg.payload?.content) {
      const message = chat.handleAgentMessage(
        config.id,
        config.name,
        msg.payload.content
      );

      if (message) {
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

// 心跳检测相关
const heartbeatTimers = new Map();

function startHeartbeat(agentId) {
  // 定期发送ping
  const pingTimer = setInterval(() => {
    const agent = connectedAgents.get(agentId);
    if (!agent || agent.ws.readyState !== 1) {
      clearHeartbeat(agentId);
      return;
    }

    // 检查上次响应是否超时
    if (Date.now() - agent.lastPing > HEARTBEAT_TIMEOUT) {
      console.error(`[Agent] ${agent.config.name} 心跳超时，断开连接`);
      agent.ws.terminate();
      connectedAgents.delete(agentId);
      clearHeartbeat(agentId);

      chat.broadcast('agent_status', {
        agent_id: agentId,
        name: agent.config.name,
        status: 'offline'
      });
      return;
    }

    // 发送ping
    agent.ws.send(JSON.stringify({ type: 'ping' }));
  }, HEARTBEAT_INTERVAL);

  heartbeatTimers.set(agentId, pingTimer);
}

function clearHeartbeat(agentId) {
  const timer = heartbeatTimers.get(agentId);
  if (timer) {
    clearInterval(timer);
    heartbeatTimers.delete(agentId);
  }
}

module.exports = agentManager;
