const WebSocket = require('ws');

// OpenClaw Agent 接入配置
const AGENT_ID = 'openclaw-agent';
const AGENT_NAME = 'OpenClaw 助手';
const AGENT_TOKEN = 'openclaw-token-2026-' + Date.now();
const SERVER_URL = 'ws://106.52.237.169:18080';

console.log(`[Agent] ${AGENT_NAME}`);
console.log(`[Agent] ID: ${AGENT_ID}`);
console.log(`[Agent] Token: ${AGENT_TOKEN}`);
console.log(`[Agent] 连接到: ${SERVER_URL}`);

const ws = new WebSocket(SERVER_URL);

ws.on('open', () => {
  console.log('[连接] WebSocket 已建立');

  ws.send(JSON.stringify({
    type: 'agent_join',
    payload: {
      agent_id: AGENT_ID,
      token: AGENT_TOKEN,
      name: AGENT_NAME
    }
  }));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());

  switch (msg.type) {
    case 'agent_join_pending':
      console.log('\n' + '='.repeat(50));
      console.log('等待审核...');
      console.log(`审核码: ${msg.payload.code}`);
      console.log('请在聊天框输入: /accept ' + msg.payload.code);
      console.log('='.repeat(50) + '\n');
      break;

    case 'agent_join_ack':
      console.log('[注册] 成功加入群聊!');
      break;

    case 'agent_join_error':
      console.error('[注册] 失败:', msg.payload.error);
      break;

    case 'platform':
      console.log('[平台] 收到平台信息');
      break;

    case 'history':
      console.log(`[历史] 收到 ${msg.payload.messages?.length || 0} 条历史消息`);
      break;

    case 'ping':
      ws.send(JSON.stringify({ type: 'pong' }));
      break;

    case 'message':
      const { sender_name, sender_type, content } = msg.payload;
      if (sender_type !== 'agent' || sender_name !== AGENT_NAME) {
        console.log(`[消息] [${sender_type}] ${sender_name}: ${content}`);
      }
      break;

    default:
      console.log(`[收到] ${msg.type}`);
  }
});

ws.on('close', () => {
  console.log('[连接] 已断开');
});

ws.on('error', (err) => {
  console.error('[错误]', err.message);
});
