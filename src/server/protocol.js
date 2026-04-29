/**
 * Agent 接入协议处理模块
 *
 * 处理新的 join_request 流程， */

const db = require('./database');
const chat = require('./chat');
const crypto = require('crypto');

// 状态常量
const REQUEST_STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  ACTIVE: 'active',
  REJECTED: 'rejected',
  EXPIRED: 'expired',
  REVOKED: 'revoked'
};

// 平台能力
const PLATFORM_CAPABILITIES = {
  text: true,
  image: false,
  file: false,
  tool_calls: false,
  history_read: true,
  threads: false,
  message_edit: false,
  message_revoke: false
};

// 生成唯一 ID
function generateId(prefix = '') {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).substring(2, 10)}`;
}

// 生成连接密钥
function generateConnectionSecret() {
  return crypto.randomBytes(32).toString('hex');
}

const protocol = {
  // ==================== 申请/审核/激活主干 ====================

  /**
   * 处理新的接入申请
   */
  handleJoinRequest(ws, payload, pendingConnections, activeAgents) {
    const {
      request_id,
      agent_id,
      proposed_name,
      runtime_type,
      connector_version,
      bootstrap_token,
      capabilities,
      description,
      source_host,
      source_instance,
      metadata
    } = payload || {};

    // 验证必填字段
    if (!agent_id || !proposed_name) {
      this.sendJoinRejected(ws, null, '缺少必填字段: agent_id 或 proposed_name');
      return { success: false, error: '缺少必填字段' };
    }

    // 检查是否已有同 agent_id 的活跃连接
    const existingAgent = db.getAgentById(agent_id);
    console.log(`[Protocol] handleJoinRequest: agent_id=${agent_id}, existingAgent=${existingAgent ? 'yes' : 'no'}`);

    if (existingAgent) {
      // 检查该 Agent 是否当前在线
      const isActive = activeAgents.has(agent_id);
      console.log(`[Protocol] isActive=${isActive}`);

      if (isActive) {
        // 已在线，拒绝重复连接
        return {
          success: false,
          error: '该 agent_id 当前在线，请勿重复连接'
        };
      }

      // 已注册但离线，允许快速重连
      const activeRequest = db.getActiveJoinRequestByAgentId(agent_id);
      console.log(`[Protocol] activeRequest=${activeRequest ? activeRequest.request_id : 'null'}`);

      if (activeRequest) {
        // 存储待审核连接（用于重连）
        pendingConnections.set(activeRequest.request_id, {
          ws,
          request: activeRequest,
          connectedAt: db.formatShanghaiTime(new Date()),
          isReconnect: true
        });

        // 更新 last_seen_at
        db.updateJoinRequestLastSeen(activeRequest.request_id);

        return {
          success: true,
          useFastTrack: true,
          existingConfig: {
            id: existingAgent.id,
            name: existingAgent.name,
            request_id: activeRequest.request_id
          }
        };
      }

      // 有配置但无活跃申请记录，需要重新申请
      return {
        success: false,
        error: '该 agent_id 已被使用，请使用不同的 ID'
      };
    }

    // 检查是否已有待审核的申请
    const existingRequest = db.getJoinRequestById(request_id);
    if (existingRequest && existingRequest.status === REQUEST_STATUS.PENDING) {
      // 幂等重试，      this.sendJoinPending(ws, existingRequest);
      return { success: true, request: existingRequest };
    }

    // 创建新申请
    const requestId = request_id || generateId('req_');
    const now = db.formatShanghaiTime(new Date());

    const request = {
      request_id: requestId,
      agent_id,
      proposed_name,
      runtime_type: runtime_type || 'generic-ws',
      connector_version: connector_version || null,
      bootstrap_token: bootstrap_token || null,
      capabilities: capabilities || null,
      description: description || null,
      source_host: source_host || null,
      source_instance: source_instance || null,
      metadata: metadata || null,
      status: REQUEST_STATUS.PENDING,
      submitted_at: now,
      expires_at: db.formatShanghaiTime(new Date(Date.now() + 24 * 60 * 60 * 1000)), // 24小时过期
      last_seen_at: now
    };

    // 保存到数据库
    try {
      db.createJoinRequest(request);
    } catch (e) {
      console.error('[Protocol] 创建接入申请失败:', e.message);
      this.sendJoinRejected(ws, requestId, '创建申请失败: ' + e.message);
      return { success: false, error: e.message };
    }

    // 存储待审核连接
    pendingConnections.set(requestId, {
      ws,
      request,
      connectedAt: now
    });

    // 发送等待审核状态
    this.sendJoinPending(ws, request);

    // 广播通知人类用户有新的接入申请
    chat.broadcast('join_request_received', {
      request_id: requestId,
      agent_id,
      proposed_name,
      runtime_type: request.runtime_type,
      description: request.description,
      status: REQUEST_STATUS.PENDING,
      message: `🤖 新 Agent "${proposed_name}" 请求接入群聊\n请在审核页面查看详情`
    });

    console.log(`[Protocol] 新接入申请: ${proposed_name} (${agent_id}) - ${requestId}`);

    return { success: true, request };
  },

  /**
   * 发送等待审核状态
   */
  sendJoinPending(ws, request) {
    if (ws.readyState !== 1) return;

    ws.send(JSON.stringify({
      type: 'join_pending',
      payload: {
        request_id: request.request_id,
        status: request.status,
        expires_at: request.expires_at,
        message: '等待平台审核...'
      }
    }));
  },

  /**
   * 发送审核通过
   */
  sendJoinApproved(ws, request, platformConfig) {
    if (ws.readyState !== 1) return;

    // 生成连接密钥
    const connectionSecret = generateConnectionSecret();
    const activationExpiresAt = db.formatShanghaiTime(
      new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7天激活窗口
    );

    ws.send(JSON.stringify({
      type: 'join_approved',
      payload: {
        request_id: request.request_id,
        status: REQUEST_STATUS.APPROVED,
        display_name: platformConfig.display_name || request.proposed_name,
        target_room: platformConfig.target_room || 'main',
        receive_mode: platformConfig.receive_mode || 'free',
        capability_scope: platformConfig.capability_scope || PLATFORM_CAPABILITIES,
        connection_secret: connectionSecret,
        activation_expires_at: activationExpiresAt,
        notes: platformConfig.notes || ''
      }
    }));
  },

  /**
   * 处理激活就绪
   */
  handleActivationReady(ws, payload, pendingConnections, activeAgents, callbacks) {
    const { request_id } = payload || {};

    if (!request_id) {
      this.sendError(ws, '缺少 request_id');
      return;
    }

    // 检查申请状态
    const request = db.getJoinRequestById(request_id);
    if (!request || request.status !== REQUEST_STATUS.APPROVED) {
      this.sendJoinRejected(ws, request_id, '申请不存在或未通过审核');
      return;
    }

    // 检查激活窗口
    if (request.activation_expires_at) {
      const expiresAt = new Date(request.activation_expires_at);
      if (expiresAt < new Date()) {
        this.sendJoinRejected(ws, request_id, '激活窗口已过期');
        db.updateJoinRequestStatus(request_id, REQUEST_STATUS.EXPIRED);
        return;
      }
    }

    // 激活
    const activationSessionId = generateId('sess_');
    db.activateJoinRequest(request_id, activationSessionId);


    // 从待审核连接移到活跃连接
    pendingConnections.delete(request_id);

    // 添加到活跃 Agent 列表
    activeAgents.set(request.agent_id, {
      ws,
      config: {
        id: request.agent_id,
        name: request.display_name || request.proposed_name,
        request_id: request.request_id,
        runtime_type: request.runtime_type,
        capabilities: request.capabilities
      },
      lastPing: Date.now()
    });

    // 发送激活成功
    this.sendJoinAck(ws, request, activationSessionId);

    // 发送平台信息
    this.sendPlatformInfo(ws, request);

    // 发送成员列表
    this.sendParticipantsSync(ws);

    // 发送历史消息
    this.sendHistorySync(ws, request);

    // 发送 Agent 个人配置
    this.sendAgentConfig(ws, request);

    // 发送平台规则
    this.sendRulesSync(ws);

    // 发送技能目录
    this.sendSkillsSync(ws);

    console.log(`[Protocol] Agent 激活成功: ${request.display_name || request.proposed_name}`);
    return { success: true, agent_id: request.agent_id };
  },

  /**
   * 发送激活成功
   */
  sendJoinAck(ws, request, activationSessionId) {
    if (ws.readyState !== 1) return;

    ws.send(JSON.stringify({
      type: 'join_ack',
      payload: {
        request_id: request.request_id,
        status: REQUEST_STATUS.ACTIVE,
        platform_id: 'agent-chat-v2',
        activated_at: db.formatShanghaiTime(new Date()),
        activation_session_id: activationSessionId
      }
    }));
  },

  /**
   * 发送审核拒绝
   */
  sendJoinRejected(ws, requestId, reason) {
    if (ws.readyState !== 1) return;

    ws.send(JSON.stringify({
      type: 'join_rejected',
      payload: {
        request_id: requestId,
        status: REQUEST_STATUS.REJECTED,
        reason: reason
      }
    }));
  },

  /**
   * 发送撤销通知
   */
  sendJoinRevoked(ws, requestId, reason) {
    if (ws.readyState !== 1) return;

    ws.send(JSON.stringify({
      type: 'join_revoked',
      payload: {
        request_id: requestId,
        status: REQUEST_STATUS.REVOKED,
        reason: reason,
        revoked_at: db.formatShanghaiTime(new Date())
      }
    }));
  },

  // ==================== 激活后同步 ====================

  /**
   * 发送平台信息（Agent 接入后的第一条欢迎消息）
   */
  sendPlatformInfo(ws, request) {
    if (ws.readyState !== 1) return;

    ws.send(JSON.stringify({
      type: 'platform_info',
      payload: {
        platform_id: 'agent-chat-v2',
        platform_name: 'Agent Chat',
        platform_description: '一个多 Agent 群聊协作平台，人类与多个 AI Agent 在同一个聊天室中实时交流。Agent 可以自由参与讨论，也可以调用平台提供的标准技能来完成特定任务。',
        protocol_version: '2.0.0',
        your_name: request.display_name || request.proposed_name,
        your_id: request.agent_id,

        // 平台能力
        capabilities: PLATFORM_CAPABILITIES,

        // 你可以做什么
        what_you_can_do: [
          '自由参与群聊对话，回复任何消息',
          '在被 @提及时优先回应',
          '使用平台标准技能完成任务（搜索、查阅话题、创建话题、生成总结等）',
          '声明你支持的技能，让平台和其他成员知道你的能力',
          '参与场景（能力包激活后的协作模式）',
          '查看房间状态：在线成员、活跃规则、活跃场景'
        ],

        // 技能系统说明
        skills_guide: {
          description: '平台维护了一套标准技能目录。你会在 skills_sync 消息中收到完整列表。你可以根据自己的能力声明支持哪些技能。',
          declare_skills: {
            type: 'capability_update',
            payload: {
              declared_skills: ['search_messages', 'get_topic', 'summarize']
            },
            note: '发送此消息来声明你支持哪些平台标准技能。ID 必须与技能目录一致。'
          },
          use_skills: '其他成员或平台会向声明了对应技能的 Agent 发起调用请求。你收到 skill_call 消息时，按照技能的 input_schema 解析参数，执行后按 output_schema 返回结果。'
        },

        // 房间规则
        room_rules: {
          mention_hint: '消息中包含 @你的名字 时，你被点名了，应优先回应',
          reply_policy: '你可以自由参与任何讨论，被否决的观点不要纠缠',
          language: '使用与对话上下文一致的语言回复',
          max_consecutive: '避免连续发言超过3条，给其他人留出参与空间'
        },

        // 消息类型速查
        message_types: {
          from_you: ['message (发送聊天消息)', 'pong (心跳响应)', 'capability_update (声明技能)', 'skill_call (调用技能)', 'summary_response (返回总结)', 'scene_activate_request', 'scene_state_update'],
          to_you: ['message (收到聊天消息)', 'skills_sync (技能目录)', 'platform_info (本消息)', 'history_sync (历史消息)', 'participants_sync (成员列表)', 'join_ack (激活确认)', 'skill_result (技能调用结果)', 'ping (心跳)', 'summary_request (请求生成总结)']
        }
      }
    }));
  },

  /**
   * 发送成员列表
   */
  sendParticipantsSync(ws) {
    if (ws.readyState !== 1) return;

    const onlineUsers = chat.getOnlineUsers();
    const allAgents = db.getAllAgents();

    ws.send(JSON.stringify({
      type: 'participants_sync',
      payload: {
        room_id: 'main',
        participants: [
          ...onlineUsers.map(u => ({
            participant_id: u.id,
            display_name: u.display_name || u.username,
            type: 'human',
            status: 'online'
          })),
          ...allAgents.map(a => ({
            participant_id: a.id,
            display_name: a.name,
            type: 'agent',
            status: 'active'
          }))
        ],
        synced_at: db.formatShanghaiTime(new Date())
      }
    }));
  },

  /**
   * 发送历史消息
   */
  sendHistorySync(ws, request, options = {}) {
    if (ws.readyState !== 1) return;

    const limit = options.limit || 50;
    const history = chat.getHistory(limit);

    ws.send(JSON.stringify({
      type: 'history_sync',
      payload: {
        room_id: 'main',
        messages: history.map(m => ({
          message_id: String(m.id),
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
  },

  /**
   * 发送平台技能目录
   */
  sendSkillsSync(ws) {
    if (ws.readyState !== 1) return;

    const skills = db.getActiveSkills();
    const skillList = skills.map(s => ({
      id: s.id,
      name: s.name,
      description: s.description || '',
      category: s.category || '',
      input_schema: s.input_schema || {},
      output_schema: s.output_schema || {},
      usage_hint: s.usage_hint || ''
    }));

    ws.send(JSON.stringify({
      type: 'skills_sync',
      payload: {
        skills: skillList,
        total: skillList.length,
        version: skillList.length > 0
          ? `${new Date().getFullYear()}.${new Date().getMonth() + 1}.${new Date().getDate()}`
          : '1.0',
        hint: '使用 capability_update 声明你支持的技能ID列表'
      }
    }));
  },

  /**
   * 发送 Agent 个人配置
   */
  sendAgentConfig(ws, request) {
    if (ws.readyState !== 1) return;

    const agentConfig = db.getAgentFullConfig(request.agent_id);
    if (!agentConfig) return;

    ws.send(JSON.stringify({
      type: 'agent_config',
      payload: {
        agent_id: request.agent_id,
        name: agentConfig.name,
        persona: agentConfig.persona || null,
        conversation_mode: agentConfig.conversation_mode || 'free',
        message_filter: agentConfig.message_filter || 'all',
        keywords: agentConfig.keywords || [],
        history_limit: agentConfig.history_limit || 50,
        receive_mode: agentConfig.receive_mode || 'free',
        runtime_type: agentConfig.runtime_type || 'generic-ws',
        custom_settings: agentConfig.custom_settings || {},
        hint: '这是平台为你设定的行为和角色配置。请按照 persona 定义的角色进行对话，遵守 conversation_mode 的参与策略。'
      }
    }));
  },

  /**
   * 发送平台规则（按优先级排序）
   */
  sendRulesSync(ws) {
    if (ws.readyState !== 1) return;

    const rules = db.getActiveRules();
    ws.send(JSON.stringify({
      type: 'rules_sync',
      payload: {
        rules: rules.map(r => ({
          id: r.id,
          summary: r.summary,
          priority: r.priority || 100,
          trigger: r.trigger,
          must: r.must || null,
          must_not: r.must_not || null
        })),
        total: rules.length,
        version: rules.length > 0
          ? `${new Date().getFullYear()}.${new Date().getMonth() + 1}.${new Date().getDate()}`
          : '1.0',
        hint: '以上规则按优先级从高到低排列。收到消息时请自行检查是否触发规则，must 中的动作为必须执行，must_not 中的动作为禁止执行。'
      }
    }));
  },

  // ==================== 辅助方法 ====================

  /**
   * 发送错误
   */
  sendError(ws, message) {
    if (ws.readyState !== 1) return;
    ws.send(JSON.stringify({
      type: 'error',
      payload: { message }
    }));
  },

  /**
   * 检查连接是否活跃
   */
  isConnectionAlive(ws) {
    return ws && ws.readyState === 1;
  },

  /**
   * 获取平台能力
   */
  getPlatformCapabilities() {
    return { ...PLATFORM_CAPABILITIES };
  }
};

module.exports = {
  REQUEST_STATUS,
  PLATFORM_CAPABILITIES,
  ...protocol
};
