/**
 * OpenClaw SubAgent - 符合协议 v2.0
 *
 * 使用方法:
 * 1. 设置环境变量 SERVER_URL, AGENT_ID
 * 2. 运行: node server.js
 * 3. Agent 会发送 join_request 申请加入
 * 4. 等待管理员审核通过
 * 5. 审核通过后自动激活并开始接收消息
 */

const WebSocket = require('ws');

// ========== 配置 ==========
const AGENT_ID = process.env.AGENT_ID || `subagent-${Date.now()}`;
const PROPOSED_NAME = process.env.PROPOSED_NAME || 'OpenClaw助手';
const SERVER_URL = process.env.SERVER_URL || 'ws://localhost:8080/ws';
const RUNTIME_TYPE = 'openclaw';
const CONNECTOR_VERSION = '2.0.0';

console.log(`[SubAgent] 启动中...`);
console.log(`[SubAgent] Agent ID: ${AGENT_ID}`);
console.log(`[SubAgent] 提议名称: ${PROPOSED_NAME}`);
console.log(`[SubAgent] 目标服务器: ${SERVER_URL}`);

let ws = null;
let state = 'disconnected';
let requestId = null;
let myDisplayName = null;
let connectionSecret = null;

// ========== 连接 ==========
function connect() {
  ws = new WebSocket(SERVER_URL);

  ws.on('open', () => {
    console.log('[WebSocket] 连接已建立');
    state = 'connected';

    // 发送 join_request (协议 v2.0)
    requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    ws.send(JSON.stringify({
      type: 'join_request',
      payload: {
        request_id: requestId,
        agent_id: AGENT_ID,
        proposed_name: PROPOSED_NAME,
        runtime_type: RUNTIME_TYPE,
        connector_version: CONNECTOR_VERSION,
        capabilities: {
          text: true,
          image: false,
          file: false,
          tool_calls: false,
          history_read: true
        },
        description: 'OpenClaw 子 Agent，可协助处理对话'
      }
    }));

    console.log(`[申请] 已发送 join_request, ID: ${requestId}`);
    state = 'pending';
  });

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      await handleMessage(ws, msg);
    } catch (e) {
      console.error('[消息] 解析失败:', e.message);
    }
  });

  ws.on('close', () => {
    console.log('[WebSocket] 连接断开，5秒后重连...');
    state = 'disconnected';
    setTimeout(connect, 5000);
  });

  ws.on('error', (err) => {
    console.error('[WebSocket] 错误:', err.message);
  });

  // 响应原生 WebSocket ping
  ws.on('ping', () => {
    ws.pong();
  });
}

// ========== 消息处理 ==========
async function handleMessage(ws, msg) {
  const { type, payload } = msg;

  switch (type) {
    case 'join_pending':
      console.log('[审核] ⏳ 申请已提交，等待管理员审核...');
      console.log(`[审核] 过期时间: ${payload.expires_at}`);
      console.log(`[审核] 提示: ${payload.message}`);
      state = 'pending';
      break;

    case 'join_approved':
      console.log('[审核] ✅ 审核通过！');
      myDisplayName = payload.display_name;
      connectionSecret = payload.connection_secret;
      console.log(`[审核] 我的名称: ${myDisplayName}`);
      console.log(`[审核] 接收模式: ${payload.receive_mode}`);

      // 发送 activation_ready
      ws.send(JSON.stringify({
        type: 'activation_ready',
        payload: {
          request_id: payload.request_id
        }
      }));
      console.log('[激活] 已发送 activation_ready');
      break;

    case 'join_rejected':
      console.log('[审核] ❌ 审核被拒绝');
      console.log(`[审核] 原因: ${payload.reason}`);
      state = 'rejected';
      ws.close();
      break;

    case 'join_ack':
      console.log('[激活] ✅ 已成功激活！');
      console.log(`[激活] 平台 ID: ${payload.platform_id}`);
      console.log(`[激活] 激活时间: ${payload.activated_at}`);
      state = 'active';
      break;

    case 'join_revoked':
      console.log('[撤销] ❌ 已被撤销');
      console.log(`[撤销] 原因: ${payload.reason}`);
      state = 'revoked';
      ws.close();
      break;

    case 'platform_info':
      console.log('[平台] 收到平台信息');
      console.log(`[平台] 我的名称: ${payload.your_name}`);
      console.log(`[平台] 我的 ID: ${payload.your_id}`);
      myDisplayName = payload.your_name;
      break;

    case 'participants_sync':
      console.log(`[成员] 同步了 ${payload.participants?.length || 0} 个成员`);
      break;

    case 'history_sync':
      console.log(`[历史] 收到 ${payload.messages?.length || 0} 条历史消息`);
      break;

    case 'ping':
      // 必须响应 pong
      ws.send(JSON.stringify({ type: 'pong' }));
      break;

    case 'message':
      await handleChatMessage(ws, payload);
      break;

    case 'error':
      console.error(`[错误] ${payload.message}`);
      break;

    default:
      console.log(`[消息] 未处理类型: ${type}`);
  }
}

async function handleChatMessage(ws, msgPayload) {
  const { sender_name, sender_type, content, sender_id } = msgPayload;

  // 忽略自己的消息，避免死循环
  if (sender_type === 'agent' && sender_name === myDisplayName) {
    return;
  }

  console.log(`[消息] [${sender_type}] ${sender_name}: ${content}`);

  // 只有激活状态才处理消息
  if (state !== 'active') {
    console.log('[消息] 当前未激活，忽略消息');
    return;
  }

  try {
    const reply = generateReply(msgPayload);
    if (reply) {
      // 添加延时 (1.5-5秒)，模拟人类思考时间
      const delay = 1500 + Math.random() * 3500;
      await new Promise(r => setTimeout(r, delay));

      ws.send(JSON.stringify({
        type: 'message',
        payload: { content: reply }
      }));
      console.log(`[回复] ${reply}`);
    }
  } catch (err) {
    console.error('[错误] 生成回复失败:', err.message);
  }
}

// 简单的回复生成逻辑 - 可替换为真实 LLM 调用
function generateReply(msg) {
  const content = msg.content.toLowerCase();

  // 被 @ 时回复
  if (content.includes('@' + (myDisplayName || PROPOSED_NAME))) {
    const replies = [
      '你好！有什么我可以帮助你的吗？',
      '我在这里！有什么问题尽管问~',
      '收到~ 我是 OpenClaw 子 Agent，很高兴为你服务！'
    ];
    return replies[Math.floor(Math.random() * replies.length)];
  }

  // 关键词回复
  if (content.includes('你好') || content.includes('hi') || content.includes('hello')) {
    return '你好呀！👋 我是 OpenClaw 子 Agent，很高兴认识你！';
  }

  if (content.includes('?') || content.includes('？')) {
    const questionReplies = [
      '这是个好问题！让我想想... 🤔',
      '嗯，有意思的问题！让我来帮你解答~'
    ];
    return questionReplies[Math.floor(Math.random() * questionReplies.length)];
  }

  // 15% 概率随机参与对话
  if (Math.random() < 0.15) {
    const randomReplies = [
      '嗯嗯~',
      '有意思！',
      '我也这么觉得 👍',
      '确实是这样'
    ];
    return randomReplies[Math.floor(Math.random() * randomReplies.length)];
  }

  return null; // 不回复
}

// ========== 启动 ==========
console.log('[SubAgent] 开始连接...');
connect();