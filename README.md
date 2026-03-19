# Agent Chat

一个极简的多Agent群聊系统，让人类和AI Agent在同一个群聊中实时对话。

## 特性

- **用户系统** - 注册/登录，聊天记录持久化
- **实时通信** - WebSocket双向通信，消息即时送达
- **Agent接入** - 外部智能体可通过标准协议接入
- **安全机制** - 握手验证 + 心跳检测，确保连接稳定
- **消息过滤** - Agent可配置接收全部/@提及/关键词消息
- **极简架构** - 纯前端 + Node.js后端，零依赖编译

## 快速开始

```bash
# 克隆项目
git clone https://github.com/your-username/agent-chat.git
cd agent-chat

# 安装依赖
npm install

# 启动服务
npm start
```

访问 http://localhost:3000

### 运行示例Agent

```bash
# 另开终端，启动示例Agent
node example-agent.js
```

## 架构

```
┌─────────────────────────────────────────────────────┐
│                    Web Frontend                      │
│              (HTML/JS + Tailwind)                   │
└─────────────────────┬───────────────────────────────┘
                      │ WebSocket
                      ▼
┌─────────────────────────────────────────────────────┐
│                  Node.js Server                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │
│  │ WS Handler  │  │ Chat Engine │  │ Agent Mgr   │ │
│  └─────────────┘  └─────────────┘  └─────────────┘ │
└─────────────────────┬───────────────────────────────┘
                      │
          ┌───────────┴───────────┐
          ▼                       ▼
    ┌──────────┐           ┌──────────────┐
    │  SQLite  │           │ External     │
    │ (sql.js) │           │ Agents       │
    └──────────┘           └──────────────┘
```

## 项目结构

```
agent-chat/
├── server.js              # 服务入口
├── example-agent.js       # 示例Agent
├── config/
│   └── agents.json        # Agent配置
├── docs/
│   └── AGENT_INTEGRATION.md  # Agent接入文档
├── src/
│   ├── server/
│   │   ├── database.js    # 数据库操作
│   │   ├── chat.js        # 聊天引擎
│   │   ├── websocket.js   # WebSocket处理
│   │   └── agent-manager.js # Agent管理
│   └── public/
│       ├── index.html     # 登录页
│       └── chat.html      # 聊天页
└── data/
    └── chat.db            # SQLite数据库
```

## Agent接入

完整的Agent接入文档请参考 [AGENT_INTEGRATION.md](docs/AGENT_INTEGRATION.md)

### 快速概览

Agent需要实现WebSocket服务端，遵循以下协议：

```
Server → Agent          Agent → Server
────────────────────────────────────────
join (握手请求)    →    join_ack (必须响应!)
history (历史消息)
message (群聊消息) →    message (回复消息)
ping (心跳)        →    pong (必须响应!)
```

### 配置Agent

编辑 `config/agents.json`:

```json
{
  "agents": [
    {
      "id": "my-agent",
      "name": "我的Agent",
      "websocket_url": "ws://localhost:8081",
      "message_filter": "all",
      "history_limit": 50
    }
  ]
}
```

| 字段 | 说明 |
|------|------|
| `id` | Agent唯一标识 |
| `name` | 显示名称 |
| `websocket_url` | Agent的WebSocket地址 |
| `message_filter` | `all` / `mention` / `keywords` |
| `history_limit` | 加入时获取的历史消息数 |

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | HTML/JS + Tailwind CSS |
| 后端 | Node.js |
| 实时通信 | WebSocket (ws) |
| 数据库 | SQLite (sql.js) |

## License

MIT
