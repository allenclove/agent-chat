const db = require('./database');

// 存储所有连接的客户端
// Map<sessionId, { ws, user }>
const clients = new Map();

// 用户授权记录 - 记录哪些Agent被用户授权可以持续对话
// Map<"agentId:userId", { authorizedAt, authorizedBy }>
const agentAuthorizations = new Map();

// 聊天引擎
const chat = {
  // 添加客户端
  addClient(sessionId, ws, user) {
    clients.set(sessionId, { ws, user });
  },

  // 移除客户端
  removeClient(sessionId) {
    clients.delete(sessionId);
  },

  // 获取所有在线用户
  getOnlineUsers() {
    const users = [];
    const seen = new Set();
    for (const [, client] of clients) {
      if (!seen.has(client.user.id)) {
        users.push({
          id: client.user.id,
          username: client.user.username,
          display_name: client.user.display_name,
          avatar_url: client.user.avatar_url
        });
        seen.add(client.user.id);
      }
    }
    return users;
  },

  // 广播消息给所有用户
  broadcast(type, payload) {
    const message = JSON.stringify({ type, payload });
    for (const [, client] of clients) {
      if (client.ws.readyState === 1) { // WebSocket.OPEN
        client.ws.send(message);
      }
    }
  },

  // 发送消息给特定客户端
  sendTo(ws, type, payload) {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type, payload }));
    }
  },

  // 处理用户发送的消息
  handleUserMessage(sessionId, content) {
    const client = clients.get(sessionId);
    if (!client) return null;

    // 检查是否是用户授权命令
    const authMatch = content.match(/\/allow-chat\s+(\S+)/i);
    if (authMatch) {
      const agentName = authMatch[1].trim();
      this.authorizeAgent(agentName, client.user.id);
      return null; // 不保存授权命令到聊天记录
    }

    const message = db.createMessage(
      client.user.id,
      client.user.display_name,
      'human',
      content
    );

    return message;
  },

  // 处理Agent发送的消息
  handleAgentMessage(agentId, agentName, content) {
    const message = db.createMessage(
      agentId,
      agentName,
      'agent',
      content
    );

    return message;
  },

  // 获取历史消息
  getHistory(limit = 50) {
    return db.getRecentMessages(limit);
  },

  // 授权Agent持续对话
  authorizeAgent(agentName, userId) {
    const key = `${agentName}:${userId}`;
    agentAuthorizations.set(key, {
      authorizedAt: Date.now(),
      authorizedBy: userId
    });
    console.log(`[Auth] Agent "${agentName}" 已被用户 ${userId} 授权持续对话`);
  },

  // 检查Agent是否被授权
  isAgentAuthorized(agentName, userId) {
    const key = `${agentName}:${userId}`;
    return agentAuthorizations.has(key);
  }
};

module.exports = chat;
