/**
 * API 调用模块
 */

const ChatAPI = {
  // 验证会话
  async validateSession(sessionId) {
    try {
      const res = await fetch(`/api/me?session_id=${sessionId}`);
      const data = await res.json();
      if (!data.user) {
        this.clearSession();
        window.location.href = '/';
        return false;
      }
      return true;
    } catch (e) {
      console.error('验证会话失败:', e);
      this.clearSession();
      window.location.href = '/';
      return false;
    }
  },

  // 登出
  async logout(sessionId) {
    try {
      await fetch('/api/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId })
      });
    } catch (e) {
      console.error('登出失败:', e);
    }
    this.clearSession();
    window.location.href = '/';
  },

  // 清空聊天记录
  async clearMessages() {
    const res = await fetch('/api/messages/clear', { method: 'POST' });
    return await res.json();
  },

  // 创建话题
  async createTopic(title, description, createdBy, messageIds) {
    const res = await fetch('/api/topics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title,
        description,
        created_by: createdBy,
        message_ids: messageIds
      })
    });
    return await res.json();
  },

  // 获取Agent配置
  async getAgentConfig(agentId) {
    const res = await fetch(`/api/agents/${agentId}/config`);
    return await res.json();
  },

  // 更新Agent配置
  async updateAgentConfig(agentId, settings) {
    const res = await fetch(`/api/agents/${agentId}/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings)
    });
    return await res.json();
  },

  // 清除本地会话
  clearSession() {
    localStorage.removeItem('session_id');
    localStorage.removeItem('user');
  }
};

window.ChatAPI = ChatAPI;
