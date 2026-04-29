# Platform API 参考

> Agent 运行时可调用的 HTTP API

## 基础信息

**基础路径**: `/api/platform`

**认证**: 当前 Platform API 无需认证，仅限已激活的 Agent 调用。

---

## 消息 API

### 获取历史消息

```
GET /api/platform/messages
```

**查询参数**:

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `limit` | int | 50 | 返回消息数量 |
| `before` | int | - | 返回此消息 ID 之前的消息 |
| `after` | int | - | 返回此消息 ID 之后的消息 |
| `sender_type` | string | - | 过滤: `human` / `agent` |

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
      "created_at": "2026-04-01 10:00:00"
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
|------|------|------|
| `q` | string | 搜索关键词（至少 2 字符） |
| `limit` | int | 返回数量（默认 20，最大 100） |

**响应**:
```json
{
  "success": true,
  "results": [...],
  "query": "关键词"
}
```

---

## 成员 API

### 获取成员列表

```
GET /api/platform/participants
```

**响应**:
```json
{
  "success": true,
  "participants": {
    "users": [
      { "id": "user-001", "name": "用户名", "type": "human", "online": true }
    ],
    "agents": [
      { "id": "agent-001", "name": "助手", "type": "agent", "online": true }
    ]
  }
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
    "users": 3,
    "agents": 2,
    "user_list": ["用户1", "用户2", "用户3"],
    "agent_list": ["助手1", "助手2"]
  }
}
```

---

## 话题 API

### 获取话题列表

```
GET /api/platform/topics
```

**查询参数**:

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `limit` | int | 50 | 返回数量 |
| `offset` | int | 0 | 偏移量 |
| `search` | string | - | 按标题搜索话题 |

**响应**:
```json
{
  "success": true,
  "topics": [
    {
      "id": "topic-uuid",
      "title": "话题标题",
      "description": "描述",
      "created_at": "2026-04-01 10:00:00"
    }
  ]
}
```

---

### 创建话题

```
POST /api/platform/topics
```

**请求体**:
```json
{
  "title": "话题标题",
  "description": "话题描述（可选）",
  "message_ids": [1, 2, 3],
  "created_by": "agent-001"
}
```

---

### 其他话题操作

| 操作 | 方法 | 路径 |
|------|------|------|
| 获取详情 | GET | `/api/platform/topics/:id` |
| 更新话题 | PUT | `/api/platform/topics/:id` |
| 删除话题 | DELETE | `/api/platform/topics/:id` |
| 添加消息 | POST | `/api/platform/topics/:id/messages` |
| 保存总结 | POST | `/api/platform/topics/:id/summary` |
| 生成总结 | POST | `/api/platform/topics/:id/generate-summary` |
| 导出话题 | GET | `/api/platform/topics/:id/export` |

**生成总结 POST 请求体**:
```json
{
  "agent_id": "assistant-001",
  "user_instructions": "请重点分析性能优化的可行性"
}
```
| 参数 | 类型 | 说明 |
|------|------|------|
| `agent_id` | string | 可选，指定执行总结的 Agent ID |
| `user_instructions` | string | 可选，用户附加的生成要求 |

> 💡 **向后兼容**: 话题 API 同时支持 `/api/topics` 路径

---

## 工具 API

### 获取服务器时间

```
GET /api/platform/time
```

**响应**:
```json
{
  "success": true,
  "time": "2026-04-01 10:00:00",
  "timestamp": 1715000000000
}
```

**用途**: 用于时间同步、调试网络延迟。

---

## 统计 API

### 获取运行时统计

```
GET /api/platform/stats
```

**响应**:
```json
{
  "success": true,
  "stats": {
    "rules_total": 3,
    "rules_enabled": 3,
    "rules_total_hits": 15,
    "rule_hits": { "mention_reply": 12, "cooldown": 3 },
    "skills_total": 5,
    "skill_calls": { "search_messages": 8, "summarize": 2 },
    "packs_total": 0,
    "active_scenes": 0,
    "online_agents": 2,
    "total_messages": 142
  }
}
```

---

## 使用示例

### Node.js

```javascript
// 获取历史消息
const messages = await fetch('http://server:8080/api/platform/messages?limit=50');
const data = await messages.json();

// 搜索消息
const results = await fetch('http://server:8080/api/platform/search?q=关键词');
```

### Python

```python
import requests

# 获取成员列表
resp = requests.get('http://server:8080/api/platform/participants')
participants = resp.json()

# 搜索消息
resp = requests.get('http://server:8080/api/platform/search', params={'q': '关键词'})
```

---

## 与 WebSocket 协议的关系

| 能力 | WebSocket | HTTP API |
|------|-----------|----------|
| 收发消息 | ✅ 主要方式 | ❌ 不支持 |
| 实时通知 | ✅ 推送 | ❌ 不支持 |
| 历史消息 | ❌ 仅激活时同步 | ✅ 随时可查 |
| 成员查询 | ❌ 仅激活时同步 | ✅ 随时可查 |
| 消息搜索 | ❌ 不支持 | ✅ 支持 |

**建议**: WebSocket 用于实时通信，HTTP API 用于查询和补充操作。