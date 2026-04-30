/**
 * Agent Manager - 管理 Agent 的连接、状态和消息
 *
 * 接入协议: join_request -> 管理员审核 -> activation_ready
 */

const db = require('./database');
const chat = require('./chat');
const protocol = require('./protocol');
const context = require('./context');
const rules = require('./rules');
const scenes = require('./scenes');
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
   * 复用 protocol 模块的方法，保证消息格式一致
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

    // 激活确认
    ws.send(JSON.stringify({
      type: 'join_ack',
      payload: {
        request_id: request_id,
        status: 'active',
        platform_id: 'agent-chat-v2',
        activated_at: db.formatShanghaiTime(new Date())
      }
    }));

    // 以下复用 protocol 模块的方法，保证与正式激活流程一致
    protocol.sendPlatformInfo(ws, {
      agent_id: agent_id,
      display_name: agentConfig.name,
      proposed_name: agentConfig.name
    });
    protocol.sendParticipantsSync(ws);
    protocol.sendHistorySync(ws, { agent_id: agent_id });
    protocol.sendSkillsSync(ws);

    // Agent 个人配置
    this.sendAgentConfigToAgent(ws, agentConfig);

    // 平台规则
    this.sendRulesToAgent(ws);

    chat.broadcast('agent_status', {
      agent_id: agentConfig.id,
      name: agentConfig.name,
      status: 'online'
    });

    this.setupAgentMessageHandler(ws, agentConfig);

    return { success: true, agentConfig };
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
        // 规则引擎 + 场景检测（与人类消息处理路径一致）
        try {
          const runtimeCtx = context.getRuntimeState(message, config.id);
          const result = rules.processRules(message, runtimeCtx);
          if (result.matchedRules.length > 0) {
            result.matchedRules.forEach(r => db.incrementRuleHitCount(r.id));
          }
          // 场景关键词检测 → 自动激活
          const triggeredScene = scenes.detectTrigger(msg.payload.content);
          if (triggeredScene && triggeredScene.auto_activate) {
            scenes.activateScene(triggeredScene.id, config.id, []);
            chat.broadcast('system', {
              type: 'scene_activated',
              message: `${triggeredScene.icon || '📦'} 已进入「${triggeredScene.name}」模式`,
              scene_id: triggeredScene.id,
              scene_name: triggeredScene.name
            });
            this.broadcastToAgents({
              type: 'scene_activated',
              payload: { scene_id: triggeredScene.id, scene_name: triggeredScene.name, scene_mode: triggeredScene.context_prompt }
            });
          }
        } catch (err) {
          console.error('[Agent] 规则/场景处理异常:', err.message);
        }

        chat.broadcast('message', message);

        // 转发给其他Agent（复用 forwardToAgents 逻辑：独立计算上下文+记录trace）
        for (const [agentId, agent] of connectedAgents) {
          if (agentId === config.id) continue;
          if (agent.ws.readyState !== 1) continue;

          const enriched = context.injectContext(message, agentId);
          const runtimeState = enriched._context?.runtime_state;
          if (runtimeState && message.trace_id) {
            traceStore.addContextEvent(message.trace_id, agentId, runtimeState);
          }
          agent.ws.send(JSON.stringify({ type: 'message', payload: enriched }));
        }
      }
    }
  },

  /**
   * 转发消息给Agent（每个Agent独立计算运行时上下文）
   */
  forwardToAgents(message) {
    const agentCount = connectedAgents.size;

    if (message && message.trace_id) {
      traceStore.addEvent(message.trace_id, EVENT_TYPES.SERVER_FORWARD_AGENT, {
        agent_count: agentCount,
        message_id: message.id
      });
    }

    for (const [agentId, agent] of connectedAgents) {
      if (agent.ws.readyState !== 1) continue;

      // 每个Agent独立计算上下文
      const enriched = context.injectContext(message, agentId);
      const runtimeState = enriched._context?.runtime_state;

      // 记录诊断追踪：每个Agent的上下文快照
      if (runtimeState && message.trace_id) {
        traceStore.addContextEvent(message.trace_id, agentId, runtimeState);
      }

      agent.ws.send(JSON.stringify({
        type: 'message',
        payload: enriched
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

  // 总结超时配置
  SUMMARY_TIMEOUT_MS: 30000,
  // topicId -> timeoutId 映射，避免定时器泄漏
  _summaryTimers: new Map(),

  requestTopicSummary(topicId, topicTitle, messages, preferAgentId = null, userInstructions = null) {
    const onlineAgents = [];
    for (const [, agent] of connectedAgents) {
      if (agent.ws.readyState === 1) {
        onlineAgents.push(agent);
      }
    }

    if (onlineAgents.length === 0) {
      console.log('[Agent] 没有在线的Agent可用于生成总结');
      return { success: false, error: '没有在线的Agent' };
    }

    // 如果指定了 agent，排到最前面
    if (preferAgentId) {
      const idx = onlineAgents.findIndex(a => a.config.id === preferAgentId);
      if (idx > 0) {
        const prefer = onlineAgents.splice(idx, 1)[0];
        onlineAgents.unshift(prefer);
      }
    }

    // 清除该topic之前的超时
    if (this._summaryTimers.has(topicId)) {
      clearTimeout(this._summaryTimers.get(topicId));
      this._summaryTimers.delete(topicId);
    }

    // 存储用户要求以供后续使用
    this._userInstructions = this._userInstructions || new Map();
    if (userInstructions) {
      this._userInstructions.set(topicId, userInstructions);
    }

    this._trySummaryAgent(0, onlineAgents, topicId, topicTitle, messages);

    return { success: true, agentName: onlineAgents[0].config.name, totalAvailable: onlineAgents.length };
  },

  _trySummaryAgent(index, agents, topicId, topicTitle, messages) {
    if (index >= agents.length) {
      console.log('[Agent] 所有Agent均未回应总结请求');
      this._summaryTimers.delete(topicId);
      chat.broadcast('topic_summary_failed', {
        topic_id: topicId,
        error: '所有在线Agent均未在超时时间内回应'
      });
      return;
    }

    const targetAgent = agents[index];
    console.log(`[Agent] 请求 ${targetAgent.config.name} 生成总结 (${index + 1}/${agents.length})`);

    const timeoutId = setTimeout(() => {
      console.log(`[Agent] ${targetAgent.config.name} 总结超时，尝试下一个`);
      this._trySummaryAgent(index + 1, agents, topicId, topicTitle, messages);
    }, this.SUMMARY_TIMEOUT_MS);

    this._summaryTimers.set(topicId, timeoutId);

    // 组装消息内容
    const chatContent = messages.map(m =>
      `[${m.original_created_at || ''}] ${m.sender_name} (${m.sender_type === 'agent' ? 'AI' : '用户'}): ${m.content}`
    ).join('\n\n');

    // 用户额外要求
    const extraInstructions = (this._userInstructions && this._userInstructions.get(topicId)) || '';
    const extraBlock = extraInstructions
      ? `\n\n## 用户额外要求\n${extraInstructions}`
      : '';

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
        instructions: `你是一位专业技术分析师。以下是一段群聊讨论记录，请输出一份详细的结构化分析文档。

## 核心原则
- 讨论中出现的每一个观点、数据、建议、分歧、决定，都必须出现在文档中。宁可冗余不可遗漏。
- 唯一可以省略的情况：与讨论主题完全无关的内容（如纯闲聊、打招呼）。
${extraBlock}

## 输出格式要求
用 Markdown 输出，严格按照以下结构：

# ${topicTitle || '讨论总结'}

## 一、背景与问题
（完整提取讨论的问题背景、现状数据、所有被提及的痛点）

## 二、技术分析
（逐一对比讨论中涉及的所有方案，包括被否决的方案——注明被否决及原因。分析各自优劣和适用场景。每个分析点不少于3句话。如涉及数据，列出具体数值。）

### 2.1 方案A vs 方案B
（表格对比或分点对比均可）
### 2.2 当前瓶颈定位
（如有）

## 三、分歧与争议
（如有分歧，列出双方理由，注明最终是否达成一致。如无分歧则写「本次讨论未出现重大分歧」）

## 四、结论
（分阶段建议：短期/中期/长期。如讨论中无明确阶段则自行推断）

## 五、待办事项
（所有明确或暗示的待办，标注优先级和提出背景）

---
> 基于 ${messages.length} 条聊天记录生成

## 写作规则
1. 全文不写「某人说」「XX提醒」「有人反驳」「XX认为」等元描述，直接陈述观点本身
2. 不写「综上所述」「总而言之」等水词
3. 每个观点独立成段，不要合并不同人的不同观点
4. 讨论中如果缺乏某方面关键信息，在对应章节末尾标注「讨论中未涉及XX」
5. 原始聊天记录如下：

${chatContent}`
      }
    }));
  },

  handleSummaryResponse(msg, agentConfig) {
    const { topic_id, summary } = msg.payload || {};

    if (!topic_id) {
      console.log('[Agent] 收到无效的总结响应：缺少topic_id');
      return;
    }

    // 解析summary（可能是JSON字符串或Markdown纯文本）
    let parsedSummary = summary;
    if (!summary) {
      console.log('[Agent] 收到空的总结响应');
      return;
    }
    if (typeof summary === 'string') {
      try {
        parsedSummary = JSON.parse(summary);
      } catch (e) {
        // Agent 直接返回了 Markdown 文本
        parsedSummary = { narrative: summary, viewpoints: [], consensus: '', open_questions: [] };
      }
    }

    // 如果是纯文本 narrative（Markdown），不再次包裹
    const narrative = parsedSummary.narrative || (typeof summary === 'string' ? summary : '');
    const viewpoints = parsedSummary.viewpoints || [];
    const consensus = parsedSummary.consensus || '';
    const openQuestions = parsedSummary.open_questions || [];

    // 清除超时
    if (this._summaryTimers.has(topic_id)) {
      clearTimeout(this._summaryTimers.get(topic_id));
      this._summaryTimers.delete(topic_id);
    }

    // 获取 agent 信息
    const agentId = agentConfig?.id || 'unknown';
    const agentName = agentConfig?.name || 'Unknown Agent';

    // 获取用户要求
    const userInstructions = (this._userInstructions && this._userInstructions.get(topic_id)) || null;
    if (this._userInstructions) this._userInstructions.delete(topic_id);

    console.log(`[Agent] 收到话题总结: ${topic_id} from ${agentName}`);

    const saved = db.saveTopicSummary(
      topic_id,
      narrative,
      viewpoints,
      consensus,
      openQuestions,
      agentId,
      agentName,
      userInstructions
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

  /**
   * 发送技能目录给指定 Agent
   */
  sendSkillsToAgent(ws) {
    if (!ws || ws.readyState !== 1) return;
    const skills = db.getActiveSkills();
    ws.send(JSON.stringify({
      type: 'skills_sync',
      payload: {
        skills: skills.map(s => ({
          id: s.id, name: s.name,
          description: s.description || '',
          category: s.category || '',
          input_schema: s.input_schema || {},
          output_schema: s.output_schema || {},
          usage_hint: s.usage_hint || ''
        })),
        total: skills.length,
        hint: '使用 capability_update 声明你支持的技能ID列表'
      }
    }));
  },

  /**
   * 广播技能目录给所有在线 Agent
   */
  broadcastSkillsSync() {
    const skills = db.getActiveSkills();
    const payload = JSON.stringify({
      type: 'skills_sync',
      payload: {
        skills: skills.map(s => ({
          id: s.id, name: s.name,
          description: s.description || '',
          category: s.category || '',
          input_schema: s.input_schema || {},
          output_schema: s.output_schema || {}
        })),
        total: skills.length,
        hint: '技能目录已更新，使用 capability_update 声明你支持的技能ID列表'
      }
    });

    let count = 0;
    for (const [, agent] of connectedAgents) {
      if (agent.ws.readyState === 1) {
        agent.ws.send(payload);
        count++;
      }
    }
    if (count > 0) {
      console.log(`[Agent] 技能目录已推送至 ${count} 个在线 Agent`);
    }
  },

  /**
   * 发送 Agent 个人配置
   */
  sendAgentConfigToAgent(ws, agentConfig) {
    if (!ws || ws.readyState !== 1) return;
    const full = db.getAgentFullConfig(agentConfig.id);
    if (!full) return;
    ws.send(JSON.stringify({
      type: 'agent_config',
      payload: {
        agent_id: full.id,
        name: full.name,
        persona: full.persona || null,
        conversation_mode: full.conversation_mode || 'free',
        message_filter: full.message_filter || 'all',
        keywords: full.keywords || [],
        history_limit: full.history_limit || 50,
        custom_settings: full.custom_settings || {},
        hint: '这是平台为你设定的行为和角色配置。请按照 persona 定义的 role 进行对话，遵守 conversation_mode 的参与策略。'
      }
    }));
  },

  /**
   * 发送平台规则给指定 Agent
   */
  sendRulesToAgent(ws) {
    if (!ws || ws.readyState !== 1) return;
    const rules = db.getActiveRules();
    ws.send(JSON.stringify({
      type: 'rules_sync',
      payload: {
        rules: rules.map(r => ({
          id: r.id, summary: r.summary, priority: r.priority || 100,
          trigger: r.trigger, must: r.must || null, must_not: r.must_not || null
        })),
        total: rules.length,
        hint: '以上规则按优先级从高到低排列。消息到达时请检查是否触发规则，must 必须执行，must_not 禁止执行。'
      }
    }));
  },

  /**
   * 广播规则更新给所有在线 Agent
   */
  broadcastRulesSync() {
    const rules = db.getActiveRules();
    const payload = JSON.stringify({
      type: 'rules_sync',
      payload: {
        rules: rules.map(r => ({
          id: r.id, summary: r.summary, priority: r.priority || 100,
          trigger: r.trigger, must: r.must || null, must_not: r.must_not || null
        })),
        total: rules.length,
        hint: '规则已更新。以上规则按优先级排列，请遵守。'
      }
    });

    let count = 0;
    for (const [, agent] of connectedAgents) {
      if (agent.ws.readyState === 1) {
        agent.ws.send(payload);
        count++;
      }
    }
    if (count > 0) {
      console.log(`[Agent] 规则已推送至 ${count} 个在线 Agent`);
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
