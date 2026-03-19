/**
 * 示例Agent - 用于测试Agent Chat系统
 *
 * 使用方法:
 * 1. 运行: node example-agent.js
 * 2. Agent将在 ws://localhost:8081 启动WebSocket服务
 * 3. 在主系统中配置此Agent即可连接
 */

const WebSocket = require('ws');

const PORT = process.env.AGENT_PORT || 8081;
const AGENT_ID = process.env.AGENT_ID || 'example-bot';
const AGENT_NAME = process.env.AGENT_NAME || '示例机器人';

const wss = new WebSocket.Server({ port: PORT });

console.log(`[Agent] ${AGENT_NAME} 启动在 ws://localhost:${PORT}`);
console.log(`[Agent] Agent ID: ${AGENT_ID}`);

wss.on('connection', (ws) => {
  console.log('[Agent] Agent Chat系统已连接');

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      handleMessage(ws, msg);
    } catch (e) {
      console.error('[Agent] 解析消息失败:', e.message);
    }
  });

  ws.on('close', () => {
    console.log('[Agent] Agent Chat系统断开连接');
  });
});

function handleMessage(ws, msg) {
  const { type, payload } = msg;

  switch (type) {
    case 'join':
      console.log(`[Agent] 收到join请求:`, payload);
      console.log(`[Agent] 协议版本: ${payload.protocol_version}`);

      // 必须发送join_ack响应！
      ws.send(JSON.stringify({
        type: 'join_ack',
        payload: {
          agent_id: AGENT_ID,
          status: 'ready'
        }
      }));
      console.log('[Agent] 已发送join_ack响应');
      break;

    case 'history':
      console.log(`[Agent] 收到历史消息: ${payload.messages?.length || 0} 条`);
      break;

    case 'ping':
      // 必须响应pong！
      ws.send(JSON.stringify({ type: 'pong' }));
      break;

    case 'message':
      console.log(`[Agent] 收到消息: [${payload.sender_type}] ${payload.sender_name}: ${payload.content}`);

      // 简单的回复逻辑 - 你可以在这里接入真实的LLM
      const reply = generateReply(payload);
      if (reply) {
        setTimeout(() => {
          ws.send(JSON.stringify({
            type: 'message',
            payload: { content: reply }
          }));
          console.log(`[Agent] 发送回复: ${reply}`);
        }, 500 + Math.random() * 1000); // 模拟思考延迟
      }
      break;

    default:
      console.log(`[Agent] 未知消息类型: ${type}`);
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
