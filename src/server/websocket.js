const WebSocket = require('ws');
const db = require('./database');
const chat = require('./chat');
const agentManager = require('./agent-manager');
const { traceStore, EVENT_TYPES } = require('./trace-store');
const rules = require('./rules');
const skills = require('./skills');
const scenes = require('./scenes');
const context = require('./context');

function setupWebSocket(server) {
  const wss = new WebSocket.Server({ server });

  wss.on('connection', (ws, req) => {
    let sessionId = null;
    let isAgent = false;
    let agentId = null;

    console.log('[WS] 新连接');

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        handleMessage(ws, msg);
      } catch (e) {
        console.error('[WS] 解析消息失败:', e.message);
        sendError(ws, '无效的消息格式');
      }
    });

    ws.on('close', () => {
      if (isDebug) {
        console.log('[WS] 调试面板断开，关闭录制');
        traceStore.setRecording(false);
      } else if (sessionId && !isAgent) {
        chat.removeClient(sessionId);
        console.log(`[WS] 用户断开: ${sessionId}`);
        broadcastUserList();
        agentManager.broadcastParticipantsUpdate();
      } else if (isAgent && agentId) {
        console.log(`[WS] Agent断开: ${agentId}`);
        chat.broadcast('agent_status', {
          agent_id: agentId,
          name: agentManager.getAgentStatus().find(a => a.id === agentId)?.name || agentId,
          status: 'offline'
        });
      }
    });

    ws.on('error', (err) => {
      console.error('[WS] 错误:', err.message);
    });

    // 心跳检测
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    let isDebug = false;  // 调试模式标记

    // 消息类型注册表（代替扁平if/else链，便于扩展）
    const HANDLERS = {
      'debug_join':            { fn: (ws, msg) => handleDebugJoin(ws, msg.payload) },
      'join_request':          { fn: (ws, msg) => handleJoinRequest(ws, msg) },
      'activation_ready':      { fn: (ws, msg) => handleActivationReady(ws, msg) },
      'pong':                  { fn: (ws) => { if (isAgent) ws.isAlive = true; }, guard: () => isAgent },
      'message':               { fn: (ws, msg) => {
        if (isAgent) {
          const s = agentManager.getAgentStatus().find(a => a.id === agentId);
          agentManager.handleAgentMessage({ id: agentId, name: s?.name || agentId }, msg);
        } else if (isDebug) {
          handleDebugMessage(ws, msg.payload);
        } else {
          handleUserMessage(ws, msg.payload);
        }
      }},
      'summary_response':      { fn: (ws, msg) => {
        const s = agentManager.getAgentStatus().find(a => a.id === agentId);
        agentManager.handleSummaryResponse(msg, { id: agentId, name: s?.name || agentId });
      }, guard: () => isAgent },
      'skill_call':            { fn: (ws, msg) => handleSkillCall(ws, msg, agentId), guard: () => isAgent },
      'capability_update':     { fn: (ws, msg) => handleCapabilityUpdate(ws, msg, agentId), guard: () => isAgent },
      'scene_activate_request':{ fn: (ws, msg) => handleSceneActivateRequest(ws, msg, agentId), guard: () => isAgent },
      'scene_state_update':    { fn: (ws, msg) => handleSceneStateUpdate(ws, msg, agentId), guard: () => isAgent },
      // 人类用户消息
      'join':                  { fn: (ws, msg) => handleJoin(ws, msg.payload), guard: () => !isAgent && !isDebug },
      'ping':                  { fn: (ws) => ws.send(JSON.stringify({ type: 'pong' })), guard: () => !isAgent }
    };

    function handleMessage(ws, msg) {
      const { type } = msg;
      const h = HANDLERS[type];
      if (h && (!h.guard || h.guard())) {
        try {
          h.fn(ws, msg);
        } catch (err) {
          console.error(`[WS] 消息处理异常 (${type}):`, err.message);
          sendError(ws, `消息处理失败: ${err.message}`);
        }
        return;
      }

      // 调试模式下的兜底
      if (isDebug) {
        sendError(ws, `调试模式不支持: ${type}`);
        return;
      }

      sendError(ws, `未知的消息类型: ${type}`);
    }

    function handleDebugJoin(ws, payload) {
      isDebug = true;
      console.log('[WS] 调试面板已连接，开启录制');

      // 开启追踪录制
      traceStore.setRecording(true);

      ws.send(JSON.stringify({
        type: 'debug_join_ack',
        payload: {
          message: '调试面板已连接，追踪录制已开启',
          server_time: new Date().toISOString(),
          recording: true
        }
      }));

      // 发送最近消息列表（带 trace_id）
      const history = chat.getHistory(50);
      const messagesWithTrace = history.map(m => ({
        ...m,
        trace_id: traceStore.getTraceIdByMessageId(m.id) || null
      }));
      ws.send(JSON.stringify({
        type: 'debug_messages',
        payload: { messages: messagesWithTrace }
      }));

      // 发送Agent状态
      ws.send(JSON.stringify({
        type: 'agent_list',
        payload: { agents: agentManager.getAgentStatus() }
      }));

      ws.send(JSON.stringify({
        type: 'user_list',
        payload: { users: chat.getOnlineUsers() }
      }));
    }

    function handleDebugMessage(ws, payload) {
      const { content } = payload;
      if (!content || !content.trim()) {
        sendError(ws, '消息内容为空');
        return;
      }

      // 调试面板发送的消息使用特殊标识
      const message = {
        id: Date.now(),
        sender_id: 'debug',
        sender_name: '🔧 调试面板',
        sender_type: 'system',
        content: content.trim(),
        created_at: db.formatShanghaiTime(new Date())
      };

      // 广播给所有用户
      chat.broadcast('message', message);

      // 转发给Agent
      agentManager.forwardToAgents(message);

      // 确认发送成功
      ws.send(JSON.stringify({
        type: 'debug_message_sent',
        payload: { success: true, message }
      }));
    }

    function handleJoin(ws, payload) {
      const { session_id } = payload;

      if (!session_id) {
        sendError(ws, '缺少session_id');
        return;
      }

      const session = db.findSessionById(session_id);
      if (!session) {
        sendError(ws, '无效的session');
        return;
      }

      sessionId = session_id;
      isAgent = false;
      chat.addClient(sessionId, ws, {
        id: session.user_id,
        username: session.username,
        display_name: session.display_name,
        avatar_url: session.avatar_url
      });

      console.log(`[WS] 用户加入: ${session.display_name}`);

      // 发送历史消息
      const history = chat.getHistory(50);
      chat.sendTo(ws, 'history', { messages: history });

      // 发送用户列表
      chat.sendTo(ws, 'user_list', { users: chat.getOnlineUsers() });

      // 发送Agent列表
      chat.sendTo(ws, 'agent_list', { agents: agentManager.getAgentStatus() });

      // 广播用户列表更新给所有人
      broadcastUserList();

      // 通知所有Agent更新成员列表
      agentManager.broadcastParticipantsUpdate();
    }

    // 处理新的接入申请 (join_request)
    function handleJoinRequest(ws, msg) {
      const result = agentManager.handleJoinRequest(ws, msg.payload);

      if (result.success) {
        // 申请创建成功，等待审核或快速重连成功
        isAgent = true;
        agentId = msg.payload.agent_id;

        if (result.useFastTrack) {
          // 快速重连成功
          console.log(`[WS] Agent 快速重连: ${agentId}`);
        } else {
          // 新申请，等待审核
          console.log(`[WS] 新接入申请: ${agentId} (${result.request?.request_id})`);
        }
      } else {
        sendError(ws, result.error);
        if (!result.pending) {
          ws.close();
        }
      }
    }

    // 处理激活就绪 (activation_ready)
    function handleActivationReady(ws, msg) {
      const result = agentManager.handleActivationReady(ws, msg.payload);

      if (result && result.success) {
        isAgent = true;
        agentId = result.agent_id;
        console.log(`[WS] Agent激活成功: ${agentId}`);
      } else {
        sendError(ws, result?.error || '激活失败');
      }
    }

    function handleUserMessage(ws, payload) {
      if (!sessionId) {
        sendError(ws, '未登录');
        return;
      }

      const { content } = payload;
      if (!content || !content.trim()) {
        return;
      }

      const trimmedContent = content.trim();

      const message = chat.handleUserMessage(sessionId, trimmedContent);
      if (message) {
        if (message.trace_id) {
          traceStore.addEvent(message.trace_id, EVENT_TYPES.SERVER_RECEIVED, {
            from_session: sessionId,
            content_length: trimmedContent.length
          });
        }

        // 规则引擎 + 能力包检测
        try {
          const allAgents = db.getAllAgents();
          const allMatched = [];
          for (const agent of allAgents) {
            const runtimeCtx = context.getRuntimeState(message, agent.id);
            const result = rules.processRules(message, runtimeCtx);
            if (result.matchedRules.length > 0) {
              result.matchedRules.forEach(r => {
                db.incrementRuleHitCount(r.id);
                allMatched.push({ rule: r.id, agent: agent.id });
              });
            }
          }
          if (allMatched.length > 0) {
            traceStore.addEvent(message.trace_id, 'rules_evaluated', { matched: allMatched });
          }
          const triggeredScene = scenes.detectTrigger(trimmedContent);
          if (triggeredScene && triggeredScene.auto_activate) {
            try {
              scenes.activateScene(triggeredScene.id, sessionId || 'system', []);
              traceStore.addEvent(message.trace_id, 'scene_activated', { scene_id: triggeredScene.id, scene_name: triggeredScene.name });
              chat.broadcast('system', {
                type: 'scene_activated',
                message: `${triggeredScene.icon || '📦'} 已进入「${triggeredScene.name}」模式`,
                scene_id: triggeredScene.id,
                scene_name: triggeredScene.name
              });
              agentManager.broadcastToAgents({
                type: 'scene_activated',
                payload: {
                  scene_id: triggeredScene.id,
                  scene_name: triggeredScene.name,
                  scene_mode: triggeredScene.context_prompt,
                  hint: '当前聊天室已切换到此模式，请按照模式要求调整行为'
                }
              });
            } catch (err) {
              console.error('[WS] 场景自动激活失败:', err.message);
            }
          } else if (triggeredScene) {
            traceStore.addEvent(message.trace_id, 'scene_detected', { scene_id: triggeredScene.id, scene_name: triggeredScene.name });
          }
        } catch (err) {
          console.error('[WS] 规则/能力包处理异常:', err.message);
        }

        // 广播给所有用户
        chat.broadcast('message', message);

        // 转发给Agent（每个Agent会独立计算运行时上下文）
        agentManager.forwardToAgents(message);
      }
    }
  });

  // 心跳检测定时器
  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) {
        return ws.terminate();
      }
      ws.isAlive = false;
      ws.ping();
    });

    // 同时ping所有Agent
    agentManager.pingAllAgents();
  }, 30000);

  wss.on('close', () => {
    clearInterval(interval);
  });

  return wss;
}

function sendError(ws, message) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify({ type: 'error', payload: { message } }));
  }
}

function broadcastUserList() {
  chat.broadcast('user_list', { users: chat.getOnlineUsers() });
}

// ==================== 平台治理相关处理 ====================

/**
 * 处理Agent调用技能
 */
async function handleSkillCall(ws, msg, agentId) {
  const { payload } = msg;
  const agent = agentManager.getAgentStatus().find(a => a.id === agentId);

  try {
    const result = await skills.executeSkill(
      payload,
      { id: agentId, name: agent?.name }
    );

    ws.send(JSON.stringify({
      type: 'skill_result',
      payload: {
        skill_id: payload.skill_id,
        ...result
      }
    }));
  } catch (err) {
    ws.send(JSON.stringify({
      type: 'skill_result',
      payload: {
        skill_id: payload.skill_id,
        status: 'failed',
        error: 'EXECUTION_ERROR',
        message: err.message
      }
    }));
  }
}

/**
 * 处理Agent能力声明更新
 */
function handleCapabilityUpdate(ws, msg, agentId) {
  const { declared_skills } = msg.payload || {};

  if (!Array.isArray(declared_skills)) {
    sendError(ws, 'declared_skills 应为数组');
    return;
  }

  try {
    db.setAgentSkillDeclaration(agentId, declared_skills);
    ws.send(JSON.stringify({
      type: 'capability_update_ack',
      payload: {
        success: true,
        agent_id: agentId,
        declared_skills
      }
    }));
    console.log(`[WS] Agent ${agentId} 更新能力声明: ${declared_skills.join(', ')}`);
  } catch (err) {
    sendError(ws, '更新能力声明失败: ' + err.message);
  }
}

/**
 * 处理场景激活请求
 */
function handleSceneActivateRequest(ws, msg, agentId) {
  const { scene_id } = msg.payload || {};

  if (!scene_id) {
    sendError(ws, 'scene_id 必填');
    return;
  }

  try {
    const scene = scenes.activateScene(scene_id, agentId, [agentId]);

    ws.send(JSON.stringify({
      type: 'scene_activate_ack',
      payload: { success: true, scene }
    }));
  } catch (err) {
    sendError(ws, '场景激活失败: ' + err.message);
  }
}

/**
 * 处理场景状态更新
 */
function handleSceneStateUpdate(ws, msg, agentId) {
  const { scene_id } = msg.payload || {};

  if (!scene_id) {
    sendError(ws, 'scene_id 必填');
    return;
  }

  try {
    scenes.deactivateScene(scene_id);
    ws.send(JSON.stringify({ type: 'scene_state_update_ack', payload: { success: true, scene_id, status: 'ended' } }));
  } catch (err) {
    sendError(ws, '场景状态更新失败: ' + err.message);
  }
}

module.exports = { setupWebSocket };
