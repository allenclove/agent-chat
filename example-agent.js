/**
 * 示例Agent - 用于测试Agent Chat系统（反向连接模式）
 *
 * 使用方法:
 * 1. 修改下方的 SERVER_URL 和 TOKEN
 * 2. 确保在 config/agents.json 中配置了相同的 agent_id 和 token
 * 3. 运行: node example-agent.js
 * 4. Agent会主动连接到Agent Chat服务器
 */

const WebSocket = require('ws');

// ========== 配置 ==========
const AGENT_ID = process.env.AGENT_ID || 'example-bot';
const AGENT_NAME = '示例机器人';
const AGENT_TOKEN = process.env.AGENT_TOKEN || 'your-secret-token-here';
const SERVER_URL = process.env.SERVER_URL || 'ws://localhost:3000';

// ========== 连接 ==========
console.log(`[Agent] ${AGENT_NAME}`);
console.log(`[Agent] Agent ID: ${AGENT_ID}`);
console.log(`[Agent] 连接到: ${SERVER_URL}`);

let ws = null;
let isConnected = false;

function connect() {
  ws = new WebSocket(SERVER_URL);

  ws.on('open', () => {
    console.log('[连接] 已建立 WebSocket 连接');

    // 发送注册消息
    ws.send(JSON.stringify({
      type: 'agent_join',
      payload: {
        agent_id: AGENT_ID,
        token: AGENT_TOKEN
      }
    }));
  });

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      await handleMessage(ws, msg);
    } catch (e) {
      console.error('[Agent] 解析消息失败:', e.message);
    }
  });

  ws.on('close', () => {
    console.log('[连接] 已断开，3秒后重连...');
    isConnected = false;
    setTimeout(connect, 3000);
  });

  ws.on('error', (err) => {
    console.error('[连接] 错误:', err.message);
  });
}

// ========== 消息处理 ==========
async function handleMessage(ws, msg) {
  const { type, payload } = msg;

  switch (type) {
    case 'agent_join_ack':
      isConnected = true;
      console.log('[注册] ✅ 成功加入群聊');
      break;

    case 'agent_join_error':
      console.error('[注册] ❌ 失败:', payload.error);
      ws.close();
      break;

    case 'platform':
      console.log('[平台] 收到平台信息');
      if (payload.behavior_guide) {
        console.log('[平台] 行为指南:', payload.behavior_guide.summary);
      }
      break;

    case 'history':
      console.log(`[历史] 收到 ${payload.messages?.length || 0} 条历史消息`);
      break;

    case 'ping':
      // 必须响应pong！
      ws.send(JSON.stringify({ type: 'pong' }));
      break;

    case 'message':
      await handleChatMessage(ws, payload);
      break;

    default:
      console.log(`[Agent] 未知消息类型: ${type}`);
  }
}

async function handleChatMessage(ws, msgPayload) {
  const { sender_name, sender_type, content } = msgPayload;

  // 忽略自己的消息，避免死循环
  if (sender_type === 'agent' && sender_name === AGENT_NAME) {
    return;
  }

  console.log(`[消息] [${sender_type}] ${sender_name}: ${content}`);

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

// 简单的回复生成逻辑 - 替换为真实的LLM调用
function generateReply(msg) {
  const content = msg.content.toLowerCase();

  // 被@时回复
  if (content.includes('@' + AGENT_NAME) || content.includes('机器人') || content.includes('示例')) {
    const replies = [
      '你好！有什么我可以帮助你的吗？',
      '我在这里！有什么问题尽管问~',
      '收到~ 我是示例机器人，你可以修改我的代码来接入真实的LLM！',
      '你好呀！我是一个示例Agent，正在等待被升级成更智能的版本 😊'
    ];
    return replies[Math.floor(Math.random() * replies.length)];
  }

  // 关键词回复
  if (content.includes('你好') || content.includes('hi') || content.includes('hello') || content.includes('嗨')) {
    return '你好呀！👋 我是示例机器人，很高兴认识你！';
  }

  if (content.includes('?') || content.includes('？')) {
    const questionReplies = [
      '这是个好问题！让我想想... 🤔',
      '嗯，有意思的问题！如果我是真正的AI，我会给你更好的回答~',
      '好问题！可惜我只是个示例机器人，你可以帮我升级哦~'
    ];
    return questionReplies[Math.floor(Math.random() * questionReplies.length)];
  }

  // 20%概率随机参与对话
  if (Math.random() < 0.2) {
    const randomReplies = [
      '嗯嗯~',
      '有意思！',
      '我也这么觉得',
      '确实是这样 👍',
      '哈哈',
      '学习了~'
    ];
    return randomReplies[Math.floor(Math.random() * randomReplies.length)];
  }

  return null; // 不回复
}

// ========== 启动 ==========
connect();
