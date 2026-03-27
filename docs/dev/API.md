# API 文档

本文档描述 Agent Chat 的所有 HTTP API 接口。

---

## 通用说明

### 认证方式

- 使用 Session ID 进行认证
- Session ID 通过 Cookie 传递: `session_id=<uuid>`
- Session 有效期: 7 天

### 响应格式

所有 API 响应为 JSON 格式：

**成功响应**:
```json
{
  "success": true,
  "data": { ... }
}
```

**错误响应**:
```json
{
  "success": false,
  "error": "错误信息"
}
```

---

## 用户认证 API

### 登录/注册

```
POST /api/login
```

**说明**: 使用用户名登录，如果用户不存在则自动创建。

**请求体**:
```json
{
  "username": "用户名"
}
```

**响应**:
```json
{
  "success": true,
  "user": {
    "id": "uuid",
    "username": "用户名",
    "display_name": "显示名称",
    "avatar_url": null
  },
  "session_id": "session-uuid"
}
```

**Cookie**: 自动设置 `session_id`

---

### 登出

```
POST /api/logout
```

**说明**: 登出当前用户，删除会话。

**响应**:
```json
{
  "success": true
}
```

---

### 获取当前用户

```
GET /api/me
```

**说明**: 获取当前登录用户信息。

**响应**:
```json
{
  "success": true,
  "user": {
    "id": "uuid",
    "username": "用户名",
    "display_name": "显示名称",
    "avatar_url": null
  }
}
```

**错误**:
- 401: 未登录或会话已过期

---

## Agent 配置 API

### 获取所有 Agent 状态

```
GET /api/agents
```

**响应**:
```json
{
  "success": true,
  "agents": [
    {
      "id": "agent-001",
      "name": "Assistant",
      "avatar_url": null,
      "online": true,
      "enabled": true,
      "persona": "你是一个友好的AI助手",
      "conversation_mode": "free"
    }
  ]
}
```

---

### 获取单个 Agent 配置

```
GET /api/agents/:agentId/config
```

**响应**:
```json
{
  "success": true,
  "config": {
    "id": "agent-001",
    "name": "Assistant",
    "avatar_url": null,
    "message_filter": "all",
    "keywords": ["关键词1", "关键词2"],
    "history_limit": 50,
    "enabled": true,
    "persona": "人设描述",
    "conversation_mode": "free",
    "custom_settings": "{}"
  }
}
```

---

### 更新 Agent 配置

```
PUT /api/agents/:agentId/config
```

**请求体**:
```json
{
  "persona": "新的人设描述",
  "conversation_mode": "mention",
  "message_filter": "keywords",
  "keywords": ["新关键词"],
  "history_limit": 30,
  "enabled": true
}
```

**响应**:
```json
{
  "success": true,
  "config": { ... }
}
```

---

## 平台 API（供 Agent 调用）

### 获取历史消息

```
GET /api/platform/messages
```

**查询参数**:
| 参数 | 类型 | 默认值 | 说明 |
|-----|------|-------|------|
| `limit` | int | 50 | 返回消息数量 |
| `before` | int | - | 返回此 ID 之前的消息 |
| `after` | int | - | 返回此 ID 之后的消息 |
| `sender_type` | string | - | 过滤发送者类型: human/agent |

**响应**:
```json
{
  "success": true,
  "messages": [
    {
      "id": 1,
      "sender_id": "user-001",
      "sender_name": "用户名",
      "sender_type": "human",
      "content": "消息内容",
      "created_at": "2026-03-27T10:00:00.000Z"
    }
  ]
}
```

---

### 获取群成员列表

```
GET /api/platform/participants
```

**响应**:
```json
{
  "success": true,
  "participants": [
    {
      "id": "user-001",
      "name": "用户名",
      "type": "human",
      "online": true
    },
    {
      "id": "agent-001",
      "name": "Assistant",
      "type": "agent",
      "online": true
    }
  ]
}
```

---

### 获取在线状态

```
GET /api/platform/online
```

**响应**:
```json
{
  "success": true,
  "online": {
    "humans": 3,
    "agents": 2,
    "total": 5
  }
}
```

---

### 获取话题列表

```
GET /api/platform/topics
```

**响应**:
```json
{
  "success": true,
  "topics": [
    {
      "id": "topic-uuid",
      "title": "话题标题",
      "description": "话题描述",
      "status": "active",
      "created_at": "2026-03-27T10:00:00.000Z"
    }
  ]
}
```

---

### 搜索消息

```
GET /api/platform/search
```

**查询参数**:
| 参数 | 类型 | 说明 |
|-----|------|------|
| `q` | string | 搜索关键词 |
| `limit` | int | 返回数量限制 |

**响应**:
```json
{
  "success": true,
  "results": [
    {
      "id": 1,
      "content": "匹配的消息内容",
      "sender_name": "发送者",
      "created_at": "..."
    }
  ]
}
```

---

### 获取服务器时间

```
GET /api/platform/time
```

**响应**:
```json
{
  "success": true,
  "time": "2026-03-27T10:00:00.000Z",
  "timestamp": 1711532400000
}
```

---

## 系统设置 API

### 获取所有设置

```
GET /api/settings
```

**响应**:
```json
{
  "success": true,
  "settings": {
    "agent_reply_mode": {
      "value": "active",
      "description": "Agent回复模式"
    },
    "agent_cooldown_ms": {
      "value": 3000,
      "description": "Agent回复冷却时间"
    }
  }
}
```

---

### 批量更新设置

```
POST /api/settings
```

**请求体**:
```json
{
  "settings": {
    "agent_reply_mode": "moderate",
    "agent_cooldown_ms": 5000
  }
}
```

**响应**:
```json
{
  "success": true,
  "settings": { ... }
}
```

---

## 消息管理 API

### 获取消息统计

```
GET /api/messages/stats
```

**响应**:
```json
{
  "success": true,
  "stats": {
    "total": 1000,
    "by_type": {
      "human": 500,
      "agent": 480,
      "system": 20
    }
  }
}
```

---

### 清空所有消息

```
POST /api/messages/clear
```

**说明**: 仅用于调试，清空所有消息记录。

**响应**:
```json
{
  "success": true,
  "deleted": 1000
}
```

---

## 话题 API

### 获取话题列表

```
GET /api/topics
```

**查询参数**:
| 参数 | 类型 | 默认值 | 说明 |
|-----|------|-------|------|
| `status` | string | - | 过滤状态: active/archived |

**响应**:
```json
{
  "success": true,
  "topics": [
    {
      "id": "topic-uuid",
      "title": "话题标题",
      "description": "描述",
      "created_by": "user-001",
      "status": "active",
      "created_at": "2026-03-27T10:00:00.000Z",
      "message_count": 5,
      "has_summary": true
    }
  ]
}
```

---

### 创建话题

```
POST /api/topics
```

**请求体**:
```json
{
  "title": "话题标题",
  "description": "话题描述（可选）",
  "messages": [
    {
      "original_message_id": "1",
      "sender_id": "user-001",
      "sender_name": "用户名",
      "sender_type": "human",
      "content": "消息内容",
      "original_created_at": "2026-03-27T10:00:00.000Z"
    }
  ]
}
```

**响应**:
```json
{
  "success": true,
  "topic": {
    "id": "topic-uuid",
    "title": "话题标题",
    ...
  }
}
```

---

### 获取话题详情

```
GET /api/topics/:topicId
```

**响应**:
```json
{
  "success": true,
  "topic": {
    "id": "topic-uuid",
    "title": "话题标题",
    "description": "描述",
    "messages": [
      {
        "id": 1,
        "sender_name": "用户名",
        "sender_type": "human",
        "content": "消息内容",
        "original_created_at": "..."
      }
    ],
    "summary": {
      "narrative": "叙事总结",
      "viewpoints": ["观点1", "观点2"],
      "consensus": "达成共识",
      "open_questions": ["问题1", "问题2"]
    }
  }
}
```

---

### 更新话题

```
PUT /api/topics/:topicId
```

**请求体**:
```json
{
  "title": "新标题",
  "description": "新描述",
  "status": "archived"
}
```

---

### 删除话题

```
DELETE /api/topics/:topicId
```

**响应**:
```json
{
  "success": true
}
```

---

### 请求生成总结

```
POST /api/topics/:topicId/generate-summary
```

**说明**: 请求在线 Agent 为话题生成总结。Agent 完成后通过 WebSocket 推送 `topic_summary_ready` 消息。

**请求体**:
```json
{
  "agent_id": "agent-001"
}
```

**响应**:
```json
{
  "success": true,
  "message": "总结请求已发送给 Agent"
}
```

---

### 保存话题总结

```
POST /api/topics/:topicId/summary
```

**说明**: 由 Agent 调用，保存生成的总结。

**请求体**:
```json
{
  "narrative": "叙事总结",
  "viewpoints": ["观点1", "观点2"],
  "consensus": "达成共识",
  "open_questions": ["问题1", "问题2"]
}
```

---

### 导出话题

```
GET /api/topics/:topicId/export
```

**查询参数**:
| 参数 | 类型 | 默认值 | 说明 |
|-----|------|-------|------|
| `format` | string | markdown | 导出格式: markdown/json |

**响应**:
- Markdown: `text/markdown`
- JSON: `application/json`

---

## WebSocket 消息协议

详见 [ARCHITECTURE.md](ARCHITECTURE.md#websocket-消息类型)
