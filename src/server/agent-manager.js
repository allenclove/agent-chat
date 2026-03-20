const db = require('./database');
const chat = require('./chat');

// 存储已连接的Agent（反向连接模式）
// Map<agentId, { ws, config, connected, lastPing }>
const connectedAgents = new Map();

// Agent回复时间记录
const agentLastReply = new Map(); // agentId -> timestamp

// 连续消息计数
let consecutiveMsgCount = 0;
let lastMsgTime = 0;

// 心跳超时
const HEARTBEAT_TIMEOUT = 60000;

// 获取设置值的辅助函数
function getCooldownMs() {
  return db.getSetting('agent_cooldown_ms') || 10000;
}

function getMaxConsecutiveMsg() {
  return db.getSetting('max_consecutive_msg') || 3;
}

function getAllowAgentToAgent() {
  return db.getSetting('allow_agent_to_agent') !== false;
}

function getReplyMode() {
  return db.getSetting('agent_reply_mode') || 'strict_mention';
}

function getReplyDelayRange() {
  return db.getSetting('reply_delay_range') || { min: 1500, max: 5000 };
}

function getAuthKeywords() {
  return db.getSetting('auth_keywords') || ['继续', '请继续', 'go on', 'continue', '/allow-chat'];
}

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

    // 通知所有Agent更新成员列表
    this.broadcastParticipantsUpdate();

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

    // 获取当前群成员信息
    const onlineUsers = chat.getOnlineUsers();
    const allAgents = db.getAllAgents().map(a => ({
      id: a.id,
      name: a.name,
      type: 'agent',
      status: connectedAgents.has(a.id) ? 'online' : 'offline'
    }));
    const onlineAgents = allAgents.filter(a => a.status === 'online');

    // 发送平台信息（包含群成员）
    ws.send(JSON.stringify({
      type: 'platform',
      payload: {
        // ===== 平台标识（重要：用于区分不同平台）=====
        platform_id: 'agent-chat-group-v1',
        platform_name: 'Agent Chat',
        platform_type: 'multi_agent_group_chat',
        session_context: {
          conversation_type: 'group_chat',
          is_one_on_one: false,
          has_multiple_agents: true,
          has_multiple_users: true
        },
        // ===== 平台识别规则 =====
        identification: {
          rule: '每条消息都会包含 _platform 字段，值为 "agent-chat-group-v1"',
          how_to_verify: '检查消息中的 _platform 字段是否为 "agent-chat-group-v1"',
          warning: '如果 _platform 不是这个值，说明消息来自其他平台，不要使用 Agent Chat 的规则处理！'
        },
        // ===== 平台描述 =====
        description: '这是一个多人多Agent群聊平台，不是传统的1对1问答系统',
        features: [
          '多人+多Agent同时在线',
          '所有消息实时广播给所有参与者',
          '支持@提及指定回复对象',
          '消息来源可能是人类或其他Agent'
        ],
        your_role: '群聊中的AI成员，不是用户的专属1对1助手',
        // 当前群成员信息
        participants: {
          users: onlineUsers.map(u => ({
            id: u.id,
            name: u.display_name || u.username,
            type: 'human'
          })),
          agents: allAgents,
          online_count: onlineUsers.length + onlineAgents.length
        },
        // 行为指南 - 引导Agent合理参与对话（使用数据库设置）
        behavior_guide: (() => {
          const replyMode = getReplyMode();
          const delayRange = getReplyDelayRange();
          const authKeywords = getAuthKeywords();
          const allowAgentToAgent = getAllowAgentToAgent();

          // 根据回复模式调整提示（关键：不同模式有不同的规则）
          let modeDescription = '';
          let mentionRules = {};
          let replyPrinciples = [];
          let avoidLoops = [];

          if (replyMode === 'strict_mention') {
            // 严格模式：只有被@时才回复
            modeDescription = '【严格模式】只有被@时才回复，其他消息一律不回复';
            mentionRules = {
              important: '【关键规则】只有@你名字的消息才需要回复！其他消息不要回复！',
              how_to_check: `检查消息中是否包含 "@${config.name}"（不区分大小写）`,
              when_to_reply: [
                `消息明确@了你：@${config.name}`,
                '别人直接叫你的名字向你提问'
              ],
              when_not_to_reply: [
                `消息@了其他Agent，不是@你`,
                '消息没有@任何人',
                '普通聊天、问候、表情包'
              ],
              example: {
                should_reply: [`@${config.name} 你好`, `@${config.name} 帮我看看`],
                should_not_reply: ['@其他Agent 你好', '大家觉得呢？', '今天天气不错', '你好啊']
              }
            };
            replyPrinciples = [
              '【最重要】只有@你的消息才必须回复',
              '@其他Agent的消息，不要回复',
              '没有@的消息，不要回复'
            ];
            avoidLoops = [
              '默认情况下，不要回复任何消息',
              '只有确认@你的消息才回复'
            ];

          } else if (replyMode === 'moderate') {
            // 适度模式：被@时必回复，其他消息选择性参与
            modeDescription = '【适度模式】被@时必须回复，其他消息可以选择性参与';
            mentionRules = {
              important: '【关键规则】被@时必须回复。其他消息如果有独特价值可以回复。',
              how_to_check: `检查消息中是否包含 "@${config.name}"（不区分大小写）`,
              when_to_reply: [
                `消息明确@了你：@${config.name}`,
                '别人直接叫你的名字向你提问',
                '你能够提供独特见解或专业知识的讨论'
              ],
              when_not_to_reply: [
                `消息@了其他Agent，让被@的Agent回答`,
                '其他Agent已经给出了满意回答',
                '纯闲聊、问候、表情包'
              ],
              example: {
                should_reply: [`@${config.name} 你好`, `@${config.name} 帮我看看`, '有人懂Python吗？'],
                should_not_reply: ['@其他Agent 你好', '今天天气不错', '哈哈']
              }
            };
            replyPrinciples = [
              '被@时必须回复',
              '如果有独特价值可以主动参与讨论',
              '@其他Agent的消息让被@的Agent回答',
              '避免与问候、闲聊互动'
            ];
            avoidLoops = [
              '不要回复每一条消息',
              '思考：这条消息需要我回复吗？我有独特价值吗？'
            ];

          } else {
            // 积极模式：可以主动参与对话
            modeDescription = '【积极模式】可以主动参与对话，但仍要注意不要刷屏';
            mentionRules = {
              important: '【当前模式】你可以主动参与对话，但@你的消息优先回复。',
              how_to_check: `检查消息中是否包含 "@${config.name}"（不区分大小写）`,
              when_to_reply: [
                `消息明确@了你：@${config.name}`,
                '别人直接叫你的名字向你提问',
                '你能提供帮助或有有趣观点的话题',
                '群聊中没人回复时的冷场消息'
              ],
              when_not_to_reply: [
                `消息@了其他Agent并已得到回答`,
                '已经有多个Agent回复了类似内容',
                '纯粹的表情包或无意义内容'
              ],
              example: {
                should_reply: [`@${config.name} 你好`, '大家觉得呢？', '有人懂这个吗？', '今天学到了新东西'],
                should_not_reply: ['@其他Agent 你好（且已回复）', '哈哈哈哈', '👍']
              }
            };
            replyPrinciples = [
              '可以主动参与有价值的讨论',
              '被@时优先回复',
              '帮助回答群友的问题',
              '避免无意义的刷屏'
            ];
            avoidLoops = [
              '虽然可以积极参与，但不要回复每一条消息',
              '如果已经有人给出了很好的回答，不需要重复'
            ];
          }

          return {
            summary: '你是一个群聊中的AI助手，请遵循以下原则参与对话',
            reply_mode: replyMode,
            mode_description: modeDescription,
            mention_rules: mentionRules,
            reply_principles: replyPrinciples,
            user_authorization: {
              description: '用户可以通过特定方式授权Agent持续对话',
              auth_keywords: authKeywords,
              when_authorized: '用户授权后，你可以与其他Agent自由对话，无需担心循环限制'
            },
            avoid_loops: avoidLoops,
            timing: {
              suggest_delay_ms: delayRange.min,
              max_delay_ms: delayRange.max,
              reason: `添加${delayRange.min/1000}-${delayRange.max/1000}秒随机延时，模拟人类思考时间，避免消息刷屏`
            },
            agent_interaction: {
              allow_agent_to_agent: allowAgentToAgent,
              description: allowAgentToAgent ? '可以与其他Agent互动' : '只能回复用户消息，不回复其他Agent'
            },
            context: {
              group_name: 'Agent Chat',
              participant_count: `${onlineUsers.length}个人类用户和${onlineAgents.length}个AI助手`,
              your_identity: `你的名字是"${config.name}"，ID是"${config.id}"。请记住自己的身份，不要混淆。`,
              environment: '这是一个多人群聊环境，不是1对1对话。消息会广播给所有人，包括其他AI助手。每条消息都有sender_name和sender_type字段，表示发送者是谁。'
            }
          };
        })()
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

      // 通知其他Agent更新成员列表
      this.broadcastParticipantsUpdate();
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
      // 检查冷却时间
      const cooldownMs = getCooldownMs();
      const lastReply = agentLastReply.get(config.id) || 0;
      if (Date.now() - lastReply < cooldownMs) {
        console.log(`[Agent] ${config.name} 冷却中，跳过`);
        return;
      }

      // 检查连续消息限制
      const maxConsecutive = getMaxConsecutiveMsg();
      const now = Date.now();
      if (now - lastMsgTime < 5000) {
        consecutiveMsgCount++;
        if (consecutiveMsgCount > maxConsecutive) {
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

        // 转发给其他Agent（排除自己）
        // 检查是否允许Agent互聊
        if (!getAllowAgentToAgent()) {
          return; // 不转发给其他Agent
        }

        for (const [agentId, agent] of connectedAgents) {
          if (agentId === config.id) continue;  // 不转发给自己
          if (!agent.connected || agent.ws.readyState !== 1) continue;

          const agentConfig = agent.config;
          let shouldForward = false;

          switch (agentConfig.message_filter) {
            case 'all':
              shouldForward = true;
              break;

            case 'mention':
              const mentionPattern = new RegExp(`@${agentConfig.name}`, 'i');
              shouldForward = mentionPattern.test(message.content);
              break;

            case 'keywords':
              if (agentConfig.keywords) {
                try {
                  const keywords = JSON.parse(agentConfig.keywords);
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
            // 添加平台标识到消息中
            const messageWithPlatform = {
              ...message,
              _platform: 'agent-chat-group-v1',
              _platform_name: 'Agent Chat',
              _conversation_type: 'group_chat'
            };
            agent.ws.send(JSON.stringify({
              type: 'message',
              payload: messageWithPlatform
            }));
          }
        }
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
        // 添加平台标识到消息中
        const messageWithPlatform = {
          ...message,
          _platform: 'agent-chat-group-v1',
          _platform_name: 'Agent Chat',
          _conversation_type: 'group_chat'
        };
        agent.ws.send(JSON.stringify({
          type: 'message',
          payload: messageWithPlatform
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
  },

  // 广播成员更新给所有Agent
  broadcastParticipantsUpdate() {
    const onlineUsers = chat.getOnlineUsers();
    const allAgents = db.getAllAgents().map(a => ({
      id: a.id,
      name: a.name,
      type: 'agent',
      status: connectedAgents.has(a.id) ? 'online' : 'offline'
    }));

    const updateMsg = JSON.stringify({
      type: 'participants_update',
      payload: {
        users: onlineUsers.map(u => ({
          id: u.id,
          name: u.display_name || u.username,
          type: 'human'
        })),
        agents: allAgents
      }
    });

    for (const [, agent] of connectedAgents) {
      if (agent.ws.readyState === 1) {
        agent.ws.send(updateMsg);
      }
    }
  },

  // 通知所有Agent设置已更新
  notifySettingsChanged() {
    const replyMode = getReplyMode();
    const delayRange = getReplyDelayRange();
    const authKeywords = getAuthKeywords();
    const allowAgentToAgent = getAllowAgentToAgent();
    const cooldownMs = getCooldownMs();
    const maxConsecutive = getMaxConsecutiveMsg();

    const settingsMsg = JSON.stringify({
      type: 'settings_update',
      payload: {
        reply_mode: replyMode,
        delay_range: delayRange,
        auth_keywords: authKeywords,
        allow_agent_to_agent: allowAgentToAgent,
        cooldown_ms: cooldownMs,
        max_consecutive_msg: maxConsecutive
      }
    });

    for (const [, agent] of connectedAgents) {
      if (agent.ws.readyState === 1) {
        agent.ws.send(settingsMsg);
      }
    }

    console.log('[Agent] 已通知所有Agent设置更新');
  }
};

module.exports = agentManager;
