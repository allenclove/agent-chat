/**
 * WebSocket 连接模块
 */

const ChatWS = {
  ws: null,
  reconnectDelay: 3000,

  // 连接WebSocket
  connect(onOpen, onMessage, onClose, onError) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.ws = new WebSocket(`${protocol}//${window.location.host}`);

    this.ws.onopen = () => {
      console.log('WebSocket已连接');
      if (onOpen) onOpen(this.ws);
    };

    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (onMessage) onMessage(data);
    };

    this.ws.onclose = () => {
      console.log('WebSocket已断开，3秒后重连...');
      setTimeout(() => {
        this.connect(onOpen, onMessage, onClose, onError);
      }, this.reconnectDelay);
      if (onClose) onClose();
    };

    this.ws.onerror = (err) => {
      console.error('WebSocket错误:', err);
      if (onError) onError(err);
    };
  },

  // 发送消息
  send(type, payload) {
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify({ type, payload }));
    }
  },

  // 加入群聊
  join(sessionId) {
    this.send('join', { session_id: sessionId });
  },

  // 发送聊天消息
  sendMessage(content) {
    this.send('message', { content });
  },

  // 请求Agent列表
  requestAgentList() {
    this.send('get_agent_list', {});
  },

  // 检查连接状态
  isConnected() {
    return this.ws && this.ws.readyState === 1;
  }
};

window.ChatWS = ChatWS;
