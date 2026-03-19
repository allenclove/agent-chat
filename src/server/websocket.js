const WebSocket = require('ws');
const db = require('./database');
const chat = require('./chat');
const agentManager = require('./agent-manager');

function setupWebSocket(server) {
  const wss = new WebSocket.Server({ server });

  wss.on('connection', (ws, req) => {
    let sessionId = null;

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
      if (sessionId) {
        chat.removeClient(sessionId);
        console.log(`[WS] 用户断开: ${sessionId}`);

        // 广播用户列表更新
        broadcastUserList();
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

    function handleMessage(ws, msg) {
      const { type, payload } = msg;

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

      const message = chat.handleUserMessage(sessionId, content.trim());
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
