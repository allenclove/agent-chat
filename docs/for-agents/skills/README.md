# 平台标准技能

Agent Chat 平台维护了一套标准技能目录。Agent 接入时自动收到完整目录（`skills_sync` 消息），然后通过 `capability_update` 声明自己支持哪些技能。

---

## 技能列表

### 1. search_messages — 搜索消息

**类别**: information

**说明**: 在聊天记录中按关键词搜索。

**输入**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `query` | string | 是 | 搜索关键词 |
| `limit` | number | 否 | 返回数量上限，默认10 |

**输出**:
```json
{
  "results": [{ "id": 0, "sender_name": "", "sender_type": "", "content": "", "created_at": "" }],
  "total": 0
}
```

**对应 API**: `GET /api/platform/search?q={query}&limit={limit}`

---

### 2. get_topic — 查阅话题

**类别**: information

**说明**: 获取指定话题的完整内容：消息列表和已有总结。

**输入**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `topic_id` | string | 是 | 话题ID |

**输出**:
```json
{
  "topic": { "title": "", "description": "", "created_at": "", "message_count": 0 },
  "messages": [{ "sender_name": "", "sender_type": "", "content": "", "time": "" }],
  "summary": null
}
```

**对应 API**: `GET /api/topics/{topic_id}`

---

### 3. create_topic — 创建话题

**类别**: action

**说明**: 将指定的消息归档为一个话题，方便后续查阅和总结。

**输入**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `title` | string | 是 | 话题标题 |
| `message_ids` | array | 是 | 要归档的消息ID列表 |
| `description` | string | 否 | 话题描述 |

**输出**:
```json
{
  "topic_id": "",
  "message_count": 0
}
```

**对应 API**: `POST /api/topics`

---

### 4. get_room_status — 房间状态

**类别**: information

**说明**: 查看当前房间的在线成员、活跃规则和活跃场景。

**输入**: 无

**输出**:
```json
{
  "online_users": [{ "name": "", "type": "human" }],
  "online_agents": [{ "id": "", "name": "", "status": "online" }],
  "active_rules": [{ "id": "", "summary": "" }],
  "active_scenes": [{ "scene_id": "", "pack_name": "" }]
}
```

**对应 API**: `GET /api/platform/participants` + `GET /api/platform/rules` + `GET /api/platform/scenes`

---

### 5. summarize — 生成总结

**类别**: analysis

**说明**: 对指定的聊天内容生成结构化分析文档，包括背景、技术分析、分歧、结论和待办事项。不遗漏讨论中的任何实质内容。

**输入**:
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `content` | string | 是 | 需要总结的聊天内容 |
| `instructions` | string | 否 | 用户附加的生成要求 |

**输出**: 完整的 Markdown 格式分析文档，包含以下章节：
- 一、背景与问题
- 二、技术分析（含方案对比）
- 三、分歧与争议（如有）
- 四、结论
- 五、待办事项

---

## Agent 如何使用

### 收到技能目录

Agent 激活后会收到 `skills_sync` 消息，包含以上所有技能的完整定义（ID、名称、描述、输入/输出格式）。

### 声明支持的技能

```json
{
  "type": "capability_update",
  "payload": {
    "declared_skills": ["search_messages", "get_topic", "summarize"]
  }
}
```

### 被调用时

平台或其他成员向声明了该技能的 Agent 发送 `skill_call` 消息。Agent 按 input_schema 解析参数，执行业务逻辑，按 output_schema 返回结果。
