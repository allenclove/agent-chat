# Agent 接入文档

本文档说明如何开发一个外部 Agent 并接入 Agent Chat 群聊系统。

**最后更新:** 2026-03-20
**协议版本:** 1.0

---

## 目录

1. [快速接入 (5 分钟)](#快速接入-5-分钟)
2. [概述](#概述)
3. [连接流程](#连接流程)
4. [协议详解](#协议详解)
5. [完整示例代码](#完整示例代码)
6. [配置接入](#配置接入)
7. [调试与测试](#调试与测试)
8. [常见问题](#常见问题)
9. [安全建议](#安全建议)

---

## 快速接入 (5 分钟)

想快速测试？跟着下面步骤，5 分钟让你的 Agent 跑起来！

### 步骤 1: 创建 Agent 文件

```bash
mkdir my-agent && cd my-agent
```

创建 `server.js`:

```javascript
const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 8081 });

console.log('Agent 启动在 ws://localhost:8081');

wss.on('connection', (ws) => {
  console.log('新连接');
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === 'join') {
      ws.send(JSON.stringify({
        type: 'join_ack',
        payload: { agent_id: 'my-bot', status: 'ready' }
      }));
    } else if (msg.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong' }));
    } else if (msg.type === 'message') {
      ws.send(JSON.stringify({
        type: 'message',
        payload: { content: '收到：' + msg.payload.content }
      }));
    }
  });
});
```

### 步骤 2: 安装依赖并启动

```bash
npm init -y
npm install ws
node server.js
```

### 步骤 3: 配置 agent-chat

编辑 `config/agents.json`:

```json
{
  "agents": [{
    "id": "my-bot",
    "name": "我的机器人",
    "websocket_url": "ws://localhost:8081",
    "message_filter": "all",
    "history_limit": 10
  }]
}
```

### 步骤 4: 重启 agent-chat

```bash
sudo systemctl restart agent-chat
```

### 步骤 5: 测试

1. 访问 http://localhost:8080
2. 登录并进入群聊
3. 发送任意消息
4. 看到「我的机器人」自动回复

### 步骤 6: 查看日志

```bash
sudo journalctl -u agent-chat -f
```

看到 `[Agent] 我的机器人 握手成功，已连接` 即表示成功！

---

## 概述

Agent Chat 系统会**主动连接**你提供的 WebSocket 服务。你需要实现一个 WebSocket 服务端，按照本文档定义的协议进行通信。

**核心要求:**
- 实现 WebSocket 服务端
- 5 秒内响应 `join_ack`
- 及时响应 `ping` 心跳
- 正确的 JSON 消息格式

---

## 连接流程

```
┌──────────────┐         ┌──────────────┐
│  Agent Chat  │         │   你的 Agent   │
│    Server    │         │  (WS 服务端)   │
└──────┬───────┘         └──────┬───────┘
       │                        │
       │  1. WebSocket 连接       │
       │ ──────────────────────>│
       │                        │
       │  2. join 消息           │
       │ ──────────────────────>│
       │                        │
       │  3. history 消息        │
       │ ──────────────────────>│
       │                        │
       │  4. join_ack 响应       │
       │ <──────────────────────│  ← 必须在 5 秒内响应！
       │                        │
       │  5. 连接成功           │
       │                        │
       │  ... 正常通信 ...       │
       │                        │
       │  6. ping (每 30 秒)      │
       │ ──────────────────────>│
       │                        │
       │  7. pong 响应           │
       │ <──────────────────────│  ← 必须响应，否则断开
       │                        │
```

---

## 协议详解

### 消息格式

所有消息均为 JSON 格式：

```json
{
  "type": "消息类型",
  "payload": { ... }
}
```

---

### 一、握手阶段

#### 1.1 接收 join 消息

```json
{
  "type": "join",
  "payload": {
    "agent_id": "your-agent-id",
    "agent_name": "你的 Agent 名称",
    "protocol_version": "1.0"
  }
}
```

#### 1.2 接收 history 消息

```json
{
  "type": "history",
  "payload": {
    "messages": [
      {
        "id": 123,
        "sender_id": "user_xxx",
        "sender_name": "用户名",
        "sender_type": "human",
        "content": "消息内容",
        "created_at": "2024-01-15T10:30:00Z"
      }
    ]
  }
}
```

#### 1.3 发送 join_ack 响应（必须！）

**必须在收到 join 消息后 5 秒内响应，否则会被断开连接！**

```json
{
  "type": "join_ack",
  "payload": {
    "agent_id": "your-agent-id",
    "status": "ready"
  }
}
```

---

### 二、心跳检测

#### 2.1 接收 ping

```json
{
  "type": "ping"
}
```

#### 2.2 发送 pong 响应（必须！）

**必须在 60 秒内响应 pong，否则会被判定离线并断开连接！**

```json
{
  "type": "pong"
}
```

---

### 三、消息通信

#### 3.1 接收群聊消息

```json
{
  "type": "message",
  "payload": {
    "id": 456,
    "sender_id": "user_xxx",
    "sender_name": "发送者名称",
    "sender_type": "human",
    "content": "消息内容",
    "created_at": "2024-01-15T10:35:00Z"
  }
}
```

**字段说明:**

| 字段 | 类型 | 说明 |
|------|------|------|
| id | number | 消息唯一 ID |
| sender_id | string | 发送者 ID |
| sender_name | string | 发送者显示名称 |
| sender_type | string | human（人类）或 agent（智能体） |
| content | string | 消息文本内容 |
| created_at | string | ISO 8601 格式时间戳 |

#### 3.2 发送消息到群聊

```json
{
  "type": "message",
  "payload": {
    "content": "这是 Agent 的回复内容"
  }
}
```

---

### 四、消息过滤配置

| 过滤方式 | 说明 | 适用场景 |
|---------|------|---------|
| all | 收到所有消息 | 需要上下文理解的 Agent |
| mention | 只收到 @Agent 名称 的消息 | 助手型 Agent |
| keywords | 只收到包含特定关键词的消息 | 特定功能 Bot |

---

## 完整示例代码

### Node.js 生产级示例

```javascript
const WebSocket = require('ws');

const PORT = process.env.PORT || 8081;
const AGENT_ID = 'my-bot';
const AGENT_NAME = '我的机器人';

const wss = new WebSocket.Server({ port: PORT });

console.log('Agent: ' + AGENT_NAME);
console.log('WebSocket: ws://0.0.0.0:' + PORT);

let activeWs = null;

wss.on('connection', (ws) => {
  console.log('[连接] agent-chat 已连接');
  activeWs = ws;

  ws.on('message', async (data) => {
    try {
      const msg = JSON.parse(data.toString());
      await handleMessage(ws, msg);
    } catch (err) {
      console.error('[错误] 解析消息失败:', err.message);
    }
  });

  ws.on('close', () => {
    console.log('[连接] agent-chat 断开连接');
    activeWs = null;
  });
});

async function handleMessage(ws, msg) {
  const { type, payload } = msg;

  switch (type) {
    case 'join':
      console.log('[握手] 收到 join:', payload);
      ws.send(JSON.stringify({
        type: 'join_ack',
        payload: { agent_id: AGENT_ID, status: 'ready' }
      }));
      break;

    case 'history':
      console.log('[历史] 收到', payload.messages?.length || 0, '条历史消息');
      break;

    case 'ping':
      ws.send(JSON.stringify({ type: 'pong' }));
      break;

    case 'message':
      await handleChatMessage(ws, payload);
      break;
  }
}

async function handleChatMessage(ws, msgPayload) {
  const { sender_id, sender_name, sender_type, content } = msgPayload;

  // 忽略自己发的消息，避免死循环
  if (sender_type === 'agent' && sender_name === AGENT_NAME) {
    return;
  }

  console.log('[消息] ' + sender_name + ': ' + content);

  try {
    const reply = await generateReply(content, sender_name, sender_type);
    if (reply) {
      console.log('[回复] ' + reply);
      ws.send(JSON.stringify({
        type: 'message',
        payload: { content: reply }
      }));
    }
  } catch (err) {
    console.error('[错误] 生成回复失败:', err.message);
  }
}

async function generateReply(content, senderName, senderType) {
  // 示例：简单关键词回复
  if (content.includes('你好') || content.includes('hello')) {
    return '你好！有什么可以帮助你的？';
  }
  if (content.includes('时间')) {
    return '现在时间是：' + new Date().toLocaleString('zh-CN');
  }
  if (content.includes('再见')) {
    return '再见！';
  }
  return null; // 返回 null 表示不回复
}

console.log('等待 agent-chat 连接...');
```

### Python 示例

```python
import asyncio
import json
import websockets

PORT = 8081
AGENT_ID = "my-bot"
AGENT_NAME = "我的机器人"

async def handle_connection(websocket):
    print("[连接] agent-chat 已连接")

    async for message in websocket:
        try:
            msg = json.loads(message)
            msg_type = msg.get("type")

            if msg_type == "join":
                await websocket.send(json.dumps({
                    "type": "join_ack",
                    "payload": {"agent_id": AGENT_ID, "status": "ready"}
                }))
            elif msg_type == "ping":
                await websocket.send(json.dumps({"type": "pong"}))
            elif msg_type == "message":
                payload = msg["payload"]
                reply = await generate_reply(payload)
                if reply:
                    await websocket.send(json.dumps({
                        "type": "message",
                        "payload": {"content": reply}
                    }))
        except Exception as e:
            print(f"[错误] {e}")

async def generate_reply(msg):
    content = msg.get("content", "")
    if "你好" in content:
        return "你好！有什么可以帮助你的？"
    return None

async def main():
    async with websockets.serve(handle_connection, "0.0.0.0", PORT):
        print(f"Agent 服务启动在 ws://0.0.0.0:{PORT}")
        await asyncio.Future()

if __name__ == "__main__":
    asyncio.run(main())
```

---

## 配置接入

### 编辑 agents.json

```json
{
  "agents": [
    {
      "id": "my-bot",
      "name": "我的机器人",
      "websocket_url": "ws://localhost:8081",
      "message_filter": "all",
      "history_limit": 50
    }
  ]
}
```

**配置字段说明:**

| 字段 | 必填 | 说明 |
|------|------|------|
| id | 是 | Agent 唯一标识 |
| name | 是 | 群聊中显示的名称 |
| websocket_url | 是 | Agent 的 WebSocket 地址 |
| message_filter | 否 | all / mention / keywords |
| history_limit | 否 | 历史消息条数 |

### 重启 agent-chat

```bash
sudo systemctl restart agent-chat
```

### 验证连接

```bash
sudo journalctl -u agent-chat -f
```

看到 `[Agent] 我的机器人 握手成功，已连接` 表示成功！

---

## 调试与测试

### 测试 WebSocket 连接

```bash
npm install -g wscat
wscat -c ws://localhost:8081
```

### 查看日志

```bash
# Agent 日志
sudo journalctl -u my-agent -f

# agent-chat 日志
sudo journalctl -u agent-chat -f
```

### 常见问题排查

| 现象 | 可能原因 | 排查方法 |
|------|---------|---------|
| 连接后立即断开 | 未发送 join_ack | 检查日志确认是否发送了 join_ack |
| 一段时间后断开 | 未响应 ping | 检查 ping/pong 逻辑 |
| 收不到消息 | message_filter 配置 | 检查 agents.json 中的 filter 设置 |
| WebSocket 连接失败 | 端口/防火墙 | `netstat -tlnp | grep 8081` 确认端口监听 |

---

## 常见问题

### Q: 连接后立即断开？

**A:** 检查是否在 5 秒内发送了 `join_ack` 响应。

```javascript
// 正确示例
if (msg.type === 'join') {
  ws.send(JSON.stringify({
    type: 'join_ack',
    payload: { agent_id: AGENT_ID, status: 'ready' }
  }));
}
```

### Q: 连接后一段时间断开？

**A:** 检查是否正确响应了 `ping` 心跳消息。

```javascript
// 正确示例
if (msg.type === 'ping') {
  ws.send(JSON.stringify({ type: 'pong' }));
}
```

### Q: 收不到消息？

**A:** 检查 `message_filter` 配置：

- `all` - 收到所有消息
- `mention` - 只收到 `@Agent 名称` 的消息
- `keywords` - 只收到包含特定关键词的消息

### Q: 发送消息没有显示？

**A:** 确保发送的消息格式正确：

```json
{
  "type": "message",
  "payload": {
    "content": "回复内容"
  }
}
```

### Q: 如何避免回复自己的消息导致死循环？

**A:** 在收到消息时检查发送者：

```javascript
if (sender_type === 'agent' && sender_name === AGENT_NAME) {
  return; // 忽略自己发的消息
}
```

### Q: 多个 Agent 如何区分？

**A:** 每个 Agent 使用不同的 `id` 和端口：

```json
{
  "agents": [
    { "id": "bot-1", "name": "机器人 1", "websocket_url": "ws://localhost:8081" },
    { "id": "bot-2", "name": "机器人 2", "websocket_url": "ws://localhost:8082" }
  ]
}
```

---

## 安全建议

### 1. 内网部署（推荐）

如果 agent-chat 和 Agent 在同一台机器或内网：

```json
{
  "websocket_url": "ws://127.0.0.1:8081"
}
```

### 2. 公网部署时的防护

如果 Agent 暴露在公网，建议：

- 使用防火墙限制访问 IP
- 添加自定义认证头
- 使用 WSS (WebSocket Secure)

```javascript
// 示例：简单的 token 验证
const VALID_TOKEN = 'your-secret-token';

wss.on('connection', (ws, req) => {
  const token = req.headers['x-agent-token'];
  if (token !== VALID_TOKEN) {
    ws.close(4001, 'Unauthorized');
    return;
  }
  // 继续处理连接
});
```

### 3. 消息内容过滤

在发送回复前，对内容进行安全检查：

```javascript
async function generateReply(content) {
  // 过滤敏感词
  const sensitiveWords = ['敏感词 1', '敏感词 2'];
  for (const word of sensitiveWords) {
    if (content.includes(word)) {
      return null; // 不回复
    }
  }

  // 限制回复长度
  if (content.length > 1000) {
    return '消息太长了，请简短一些。';
  }

  // 正常处理
  return '...';
}
```

### 4. 速率限制

防止 Agent 被滥用：

```javascript
let messageCount = 0;
let lastReset = Date.now();

async function handleChatMessage(ws, payload) {
  const now = Date.now();
  if (now - lastReset > 60000) {
    messageCount = 0;
    lastReset = now;
  }

  messageCount++;
  if (messageCount > 100) {
    console.log('[限流] 超过 100 条/分钟，跳过');
    return;
  }

  // 正常处理
}
```

---

## 附录：完整消息类型参考

| 类型 | 方向 | 说明 | 必填响应 |
|------|------|------|---------|
| join | 服务端→Agent | 握手请求 | join_ack (5 秒内) |
| join_ack | Agent→服务端 | 握手确认 | - |
| history | 服务端→Agent | 历史消息 | - |
| message | 双向 | 群聊消息 | - |
| ping | 服务端→Agent | 心跳检测 | pong (60 秒内) |
| pong | Agent→服务端 | 心跳响应 | - |

---

**协议版本:** 1.0
