const WebSocket = require('ws');
const db = require('./database');
const chat = require('./chat');
const agentManager = require('./agent-manager');

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
      if (sessionId && !isAgent) {
        chat.removeClient(sessionId);
        console.log(`[WS] 用户断开: ${sessionId}`);
        broadcastUserList();
        // 通知所有Agent更新成员列表
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

    function handleMessage(ws, msg) {
      const { type, payload } = msg;

      // 处理调试连接
      if (type === 'debug_join') {
        handleDebugJoin(ws, payload);
        return;
      }

      // 处理Agent消息
      if (type === 'agent_join') {
        handleAgentJoin(ws, msg);
        return;
      }

      // 处理Agent的pong响应
      if (type === 'pong' && isAgent) {
        ws.isAlive = true;
        return;
      }

      // 处理Agent发送的消息
      if (type === 'message' && isAgent) {
        // 获取agent配置信息
        const agentStatus = agentManager.getAgentStatus().find(a => a.id === agentId);
        agentManager.handleAgentMessage(
          { id: agentId, name: agentStatus?.name || agentId },
          msg
        );
        return;
      }

      // 处理Agent返回的总结响应
      if (type === 'summary_response' && isAgent) {
        agentManager.handleSummaryResponse(msg);
        return;
      }

      // 调试模式下只允许只读操作
      if (isDebug) {
        switch (type) {
          case 'ping':
            ws.send(JSON.stringify({ type: 'pong' }));
            break;
          case 'message':
            // 调试面板可以发送测试消息
            handleDebugMessage(ws, payload);
            break;
          default:
            sendError(ws, `调试模式不支持: ${type}`);
        }
        return;
      }

      // 处理人类用户消息
      switch (type) {
        case 'join':
          handleJoin(ws, payload);
          break;

        case 'message':
          handleUserMessage(ws, payload);
          break;

        case 'ping':
          ws.send(JSON.stringify({ type: 'pong' }));
          break;

        default:
          sendError(ws, `未知的消息类型: ${type}`);
      }
    }

    function handleDebugJoin(ws, payload) {
      isDebug = true;
      console.log('[WS] 调试面板已连接');

      // 发送确认
      ws.send(JSON.stringify({
        type: 'debug_join_ack',
        payload: {
          message: '调试面板已连接',
          server_time: new Date().toISOString()
        }
      }));

      // 发送Agent状态
      ws.send(JSON.stringify({
        type: 'agent_list',
        payload: { agents: agentManager.getAgentStatus() }
      }));

      // 发送历史消息
      const history = chat.getHistory(20);
      ws.send(JSON.stringify({
        type: 'history',
        payload: { messages: history }
      }));

      // 发送在线用户
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

    function handleAgentJoin(ws, msg) {
      const result = agentManager.handleAgentConnection(ws, msg);

      if (result.success) {
        isAgent = true;
        agentId = msg.payload.agent_id;
        console.log(`[WS] Agent验证成功: ${agentId}`);
      } else if (result.pending) {
        // 等待审核，不关闭连接
        isAgent = true;
        agentId = msg.payload.agent_id;
        console.log(`[WS] Agent等待审核: ${agentId} (审核码: ${result.code})`);
      } else {
        sendError(ws, result.error);
        ws.close();
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

      // 检查是否是 /accept 命令（快速匹配接入）
      const acceptMatch = trimmedContent.match(/^\/accept\s+(\d{4})$/);
      if (acceptMatch) {
        const code = acceptMatch[1];
        const result = agentManager.approveAgentByCode(code);

        if (result.success) {
          // 发送系统消息
          const sysMessage = {
            id: Date.now(),
            sender_id: 'system',
            sender_name: '系统',
            sender_type: 'system',
            content: `✅ Agent "${result.agentName}" 已成功加入群聊`,
            created_at: db.formatShanghaiTime(new Date())
          };
          chat.broadcast('message', sysMessage);
        } else {
          // 发送错误提示
          ws.send(JSON.stringify({
            type: 'system',
            payload: { message: `❌ ${result.error}` }
          }));
        }
        return;
      }

      // 正常消息处理
      const message = chat.handleUserMessage(sessionId, trimmedContent);
      if (message) {
        // 广播给所有用户
        chat.broadcast('message', message);

        // 转发给Agent
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

module.exports = { setupWebSocket };
