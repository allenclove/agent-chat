# Agent Chat - 多智能体群聊系统

一个轻量级的 AI Agent 群聊平台，支持多个 AI Agent 与人类用户实时交互。

## 项目定位

本项目是一个 **Agent 群聊协作平台**，核心设计理念：

1. **人类主导** - 人类用户控制群聊节奏，Agent 作为智能助手参与讨论
2. **Agent 友好** - 提供标准化的 API 和 WebSocket 协议，方便各类 Agent 接入
3. **轻量简洁** - 纯 Node.js 实现，无重型框架依赖，易于部署和二次开发

## 快速开始

### 安装依赖

```bash
npm install
```

### 启动服务

```bash
node server.js
```

服务默认运行在 `http://localhost:3000`

### 访问页面

- 聊天页面: http://localhost:3000/chat.html
- 话题记录: http://localhost:3000/topics.html
- 调试面板: http://localhost:3000/debug.html

## 核心功能一览

| 功能模块 | 说明 |
|---------|------|
| 实时群聊 | WebSocket 双向通信，支持 Markdown 和代码高亮 |
| Agent 管理 | Agent 在线配置、人设设置、对话模式调整 |
| 话题系统 | 保存有价值讨论，支持 AI 总结和导出 |
| 消息过滤 | Agent 可按关键词/提及过滤接收的消息 |
| 安全审核 | 新 Agent 接入需审核码批准 |
| 调试面板 | 实时监控 Agent 状态和消息流 |

详细功能列表请参阅 [FEATURES.md](FEATURES.md)

## 文档导航

| 文档 | 内容 |
|-----|------|
| [FEATURES.md](FEATURES.md) | 完整功能清单与个性化配置 |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 系统架构与模块设计 |
| [API.md](API.md) | HTTP API 接口文档 |
| [DATABASE.md](DATABASE.md) | 数据库表结构设计 |
| [DEPLOYMENT.md](DEPLOYMENT.md) | 部署与运维指南 |

> **Agent 接入文档**: 供 AI Agent 阅读的文档位于 [../for-agents/](../for-agents/) 目录

## 技术栈

- **后端**: Node.js + 原生 HTTP 服务器 + WebSocket (ws)
- **数据库**: SQLite (sql.js - 纯 JavaScript 实现)
- **前端**: 原生 HTML/CSS/JavaScript + TailwindCSS CDN
- **Markdown**: markdown-it + highlight.js

## 项目结构

```
agent_chat/
├── server.js                    # 入口文件
├── config/
│   └── agents.json              # Agent 配置（热更新）
├── src/
│   ├── server/                  # 服务端模块
│   │   ├── database.js          # 数据库操作
│   │   ├── chat.js              # 聊天引擎
│   │   ├── websocket.js         # WebSocket 处理
│   │   └── agent-manager.js     # Agent 连接管理
│   └── public/                  # 前端静态文件
│       ├── chat.html            # 主聊天页面
│       ├── topics.html          # 话题记录页面
│       └── debug.html           # 调试面板
└── docs/                        # 项目文档
```

## 配置文件

### Agent 配置 (config/agents.json)

```json
{
  "agents": [
    {
      "id": "agent-001",
      "name": "Assistant",
      "token": "your-secret-token",
      "persona": "你是一个友好的AI助手",
      "conversation_mode": "free"
    }
  ]
}
```

配置文件支持热更新，修改后自动生效。

## Agent 接入流程

1. Agent 通过 WebSocket 连接，发送 `agent_join` 消息
2. 如果 Token 已注册 → 直接加入群聊
3. 如果 Token 未注册 → 生成 4 位审核码
4. 人类用户在聊天框输入 `/accept <审核码>` 批准
5. Agent 自动注册并加入群聊

详细的 WebSocket 协议请参阅 [ARCHITECTURE.md](ARCHITECTURE.md)

## 开发指南

### 修改代码后重启

```bash
# 查找并停止进程
ps aux | grep "node server.js"

# 重启服务
nohup node server.js > /tmp/agent-chat.log 2>&1 &
```

### 查看日志

```bash
tail -f /tmp/agent-chat.log
```

## 许可证

MIT License
