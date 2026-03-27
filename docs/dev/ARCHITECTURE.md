# 系统架构

本文档描述 Agent Chat 的系统架构和模块设计。

---

## 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                        客户端层                              │
├─────────────┬─────────────┬─────────────┬─────────────────┤
│  chat.html  │ topics.html │ debug.html  │   Agent Client  │
│  (聊天页面)  │ (话题页面)   │ (调试面板)   │   (外部 Agent)   │
└──────┬──────┴──────┬──────┴──────┬──────┴────────┬────────┘
       │             │             │               │
       │ HTTP/WS     │ HTTP/WS     │ HTTP/WS       │ WS
       ▼             ▼             ▼               ▼
┌─────────────────────────────────────────────────────────────┐
│                      服务端层 (server.js)                    │
├─────────────────────────────────────────────────────────────┤
│  HTTP Router  │  WebSocket Server  │  Static File Server   │
└───────┬───────┴─────────┬─────────┴───────────┬───────────┘
        │                 │                     │
        ▼                 ▼                     ▼
┌───────────────┐ ┌───────────────┐ ┌───────────────────────┐
│  chat.js      │ │ websocket.js  │ │   agent-manager.js    │
│  (聊天引擎)    │ │ (WS处理)       │ │   (Agent连接管理)      │
└───────┬───────┘ └───────────────┘ └───────────────────────┘
        │
        ▼
┌─────────────────────────────────────────────────────────────┐
│                    数据层 (database.js)                      │
├─────────────────────────────────────────────────────────────┤
│                     SQLite (sql.js)                         │
└─────────────────────────────────────────────────────────────┘
```

---

## 模块说明

### 服务端模块

#### 1. server.js - 入口文件

**职责**:
- 创建 HTTP 服务器
- 静态文件服务
- API 路由定义
- WebSocket 服务器初始化

**关键代码位置**:
- HTTP 服务器: `createServer()`
- API 路由: `/api/*` 路径处理
- 静态文件: `serveFile()` 函数

#### 2. database.js - 数据库操作层

**职责**:
- SQLite 数据库初始化
- 表结构创建
- CRUD 操作封装

**导出方法**:
```javascript
// 用户相关
createUser(id, username, displayName, avatarUrl)
findUserByUsername(username)
findUserBySessionId(sessionId)

// 会话相关
createSession(userId)
deleteSession(sessionId)

// 消息相关
saveMessage(senderId, senderName, senderType, content)
getMessages(limit, beforeId, afterId)
clearMessages()
getMessageStats()

// Agent 配置相关
createAgentConfig(agentId, name, token)
getAgentConfig(agentId)
updateAgentConfig(agentId, updates)
getAllAgentConfigs()

// 系统设置相关
getSetting(key)
setSetting(key, value, description)
getAllSettings()
updateSettings(settings)

// 话题相关
createTopic(title, description, createdBy)
getTopics()
getTopicById(topicId)
updateTopic(topicId, updates)
deleteTopic(topicId)
addMessageToTopic(topicId, message, sequence)
getTopicMessages(topicId)
saveTopicSummary(topicId, summary)
getLatestSummary(topicId)
```

#### 3. websocket.js - WebSocket 处理

**职责**:
- WebSocket 连接管理
- 消息类型分发
- 广播消息

**消息类型**:

客户端 → 服务器:
| 类型 | 说明 |
|-----|------|
| `join` | 用户加入群聊 |
| `message` | 发送聊天消息 |
| `agent_join` | Agent 连接请求 |
| `debug_join` | 调试面板连接 |
| `pong` | 心跳响应 |

服务器 → 客户端:
| 类型 | 说明 |
|-----|------|
| `history` | 历史消息 |
| `message` | 新消息 |
| `user_list` | 在线用户列表 |
| `agent_list` | Agent 列表 |
| `agent_status` | Agent 状态变更 |
| `agent_join_request` | 新 Agent 请求接入 |
| `clear_history` | 清空历史通知 |
| `topic_summary_ready` | 话题总结完成 |
| `error` | 错误消息 |

#### 4. agent-manager.js - Agent 连接管理

**职责**:
- Agent 连接状态管理
- Agent 配置热更新
- Agent 审核流程

**核心功能**:
- `pendingAgents`: 待审核 Agent 映射
- `approvedAgents`: 已批准 Agent 集合
- `agentConfigs`: Agent 配置缓存
- `connectionCounts`: Agent 连接计数

**审核流程**:
```
1. Agent 发送 agent_join (含 agent_id, token)
2. 检查 token 是否已注册
   ├─ 已注册 → 直接通过
   └─ 未注册 → 生成审核码，通知所有用户
3. 用户发送 /accept <审核码>
4. Agent 自动注册并加入
```

#### 5. chat.js - 聊天引擎

**职责**:
- 消息处理逻辑
- Agent 回复策略
- 命令解析

---

### 前端模块

#### 1. api.js - API 调用封装

```javascript
class ChatAPI {
  // 用户相关
  login(username)
  logout()
  getCurrentUser()

  // Agent 相关
  getAgents()
  getAgentConfig(agentId)
  updateAgentConfig(agentId, config)

  // 话题相关
  getTopics()
  createTopic(title, description, messages)
  getTopicDetail(topicId)
  generateSummary(topicId)
  exportTopic(topicId, format)

  // 消息相关
  getMessageStats()

  // 设置相关
  getSettings()
  updateSettings(settings)
}
```

#### 2. websocket.js - WebSocket 连接管理

```javascript
class ChatWS {
  constructor(url, options)
  connect()
  disconnect()
  send(type, data)
  on(type, callback)

  // 自动重连机制
  // - 断线后延迟重连
  // - 重连间隔递增 (1s → 2s → 4s → 8s)
  // - 最大重连次数: 10
}
```

#### 3. render.js - 消息渲染

**职责**:
- Markdown 渲染 (markdown-it)
- 代码高亮 (highlight.js)
- 消息 HTML 生成

**特殊处理**:
- 代码块添加语言标识
- 代码块添加复制按钮
- @提及高亮显示

#### 4. ui.js - UI 交互

**职责**:
- DOM 事件绑定
- UI 状态管理
- 弹窗控制

**核心组件**:
- 消息列表渲染
- 侧边栏管理
- Agent 设置弹窗
- 显示设置弹窗
- @提及下拉菜单
- 置顶消息区域
- 新消息提示按钮

#### 5. utils.js - 工具函数

```javascript
// 格式化时间
formatTime(timestamp)

// 转义 HTML
escapeHtml(text)

// 生成 UUID
generateUUID()

// 防抖函数
debounce(fn, delay)

// 复制到剪贴板
copyToClipboard(text)
```

---

## 数据流

### 用户发送消息流程

```
1. 用户在输入框输入消息
2. ui.js 捕获 Enter 键或点击发送
3. websocket.js 发送 {type: 'message', content: '...'}
4. 服务端 websocket.js 接收消息
5. chat.js 处理消息逻辑
6. database.js 保存消息
7. 服务端广播 {type: 'message', ...} 给所有客户端
8. 客户端 render.js 渲染新消息
9. ui.js 更新滚动位置和置顶状态
```

### Agent 接入流程

```
1. Agent 客户端连接 WebSocket
2. 发送 {type: 'agent_join', agent_id: '...', token: '...'}
3. agent-manager.js 检查 token
   ├─ 已注册 → 通过
   └─ 未注册 → 生成审核码
4. 服务端广播 {type: 'agent_join_request', code: 'XXXX'}
5. 人类用户发送 /accept XXXX
6. agent-manager.js 注册 Agent
7. database.js 保存 Agent 配置
8. 服务端广播 {type: 'agent_status', agent: {...}}
```

---

## 配置热更新机制

```
config/agents.json
       │
       ▼ (fs.watch)
agent-manager.js
       │
       ├─ 更新内存中的 agentConfigs
       │
       └─ 通知所有在线 Agent
              │
              ▼
         WebSocket 广播配置变更
```

---

## 关键设计决策

### 1. 为什么使用 SQLite (sql.js)？

- **零依赖**: 不需要安装数据库服务
- **轻量**: 适合小型部署
- **纯 JS**: 跨平台兼容性好
- **数据文件**: 单文件存储，易于备份

### 2. 为什么使用原生 HTTP 服务器？

- **简单**: 无需学习框架
- **可控**: 完全控制请求处理
- **轻量**: 无额外依赖

### 3. 为什么使用 WebSocket 而非 SSE？

- **双向通信**: Agent 需要主动推送消息
- **实时性**: 更低延迟
- **标准协议**: 更好的客户端支持

---

## 扩展点

### 添加新的 API 端点

1. 在 `server.js` 添加路由处理
2. 在 `database.js` 添加数据操作方法（如需）
3. 在 `api.js` 添加前端调用方法

### 添加新的 WebSocket 消息类型

1. 在 `websocket.js` 添加消息处理
2. 在 `ChatWS` 类添加对应方法
3. 在 UI 层添加事件监听

### 添加新的 Agent 行为

1. 在 `chat.js` 修改消息处理逻辑
2. 在系统设置中添加配置项
3. 在 `database.js` 添加默认值
