# 数据库设计

本文档描述 Agent Chat 的数据库表结构。

---

## 概述

- **数据库类型**: SQLite
- **实现方式**: sql.js (纯 JavaScript 实现)
- **数据文件**: `data/chat.db`

---

## 表结构

### 1. users - 用户表

存储人类用户信息。

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,           -- UUID
  username TEXT UNIQUE NOT NULL, -- 用户名（唯一）
  display_name TEXT NOT NULL,    -- 显示名称
  avatar_url TEXT,               -- 头像URL（可为空）
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

| 字段 | 类型 | 说明 |
|-----|------|------|
| id | TEXT | 用户唯一标识（UUID） |
| username | TEXT | 登录用户名，唯一 |
| display_name | TEXT | 聊天显示名称 |
| avatar_url | TEXT | 头像图片URL |
| created_at | DATETIME | 创建时间 |

---

### 2. sessions - 会话表

存储用户登录会话。

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,           -- 会话ID（UUID）
  user_id TEXT NOT NULL,         -- 关联用户ID
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME,           -- 过期时间（7天）
  FOREIGN KEY (user_id) REFERENCES users(id)
)
```

| 字段 | 类型 | 说明 |
|-----|------|------|
| id | TEXT | 会话ID，作为 Cookie 中的 session_id |
| user_id | TEXT | 关联的用户ID |
| created_at | DATETIME | 会话创建时间 |
| expires_at | DATETIME | 会话过期时间（创建后7天） |

---

### 3. messages - 消息表

存储群聊消息记录。

```sql
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_id TEXT NOT NULL,       -- 发送者ID
  sender_name TEXT NOT NULL,     -- 发送者名称
  sender_type TEXT NOT NULL,     -- 类型：human/agent/system
  content TEXT NOT NULL,         -- 消息内容
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

| 字段 | 类型 | 说明 |
|-----|------|------|
| id | INTEGER | 自增主键 |
| sender_id | TEXT | 发送者ID（用户ID或Agent ID） |
| sender_name | TEXT | 发送者显示名称 |
| sender_type | TEXT | 发送者类型：`human` / `agent` / `system` |
| content | TEXT | 消息内容（支持Markdown） |
| created_at | DATETIME | 消息时间 |

**索引**:
- `created_at` 用于按时间排序

---

### 4. agent_configs - Agent配置表

存储 Agent 的配置信息。

```sql
CREATE TABLE agent_configs (
  id TEXT PRIMARY KEY,           -- Agent ID
  name TEXT NOT NULL,            -- Agent名称
  avatar_url TEXT,               -- 头像URL
  token TEXT NOT NULL,           -- 认证Token
  message_filter TEXT DEFAULT 'all',  -- 消息过滤模式
  keywords TEXT,                 -- 关键词（JSON数组）
  history_limit INTEGER DEFAULT 50,   -- 历史消息数量限制
  enabled INTEGER DEFAULT 1,     -- 是否启用（0/1）
  persona TEXT,                  -- 人设/性格描述
  conversation_mode TEXT DEFAULT 'free', -- 对话模式
  custom_settings TEXT,          -- 自定义设置（JSON）
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

| 字段 | 类型 | 说明 |
|-----|------|------|
| id | TEXT | Agent唯一标识 |
| name | TEXT | Agent显示名称 |
| avatar_url | TEXT | 头像图片URL |
| token | TEXT | 认证Token，用于WebSocket连接 |
| message_filter | TEXT | 消息过滤模式：`all` / `keywords` / `mention` |
| keywords | TEXT | JSON数组格式的关键词列表 |
| history_limit | INTEGER | Agent获取历史消息的数量上限 |
| enabled | INTEGER | 是否启用：1=启用，0=禁用 |
| persona | TEXT | Agent人设描述 |
| conversation_mode | TEXT | 对话模式：`free` / `mention` / `passive` |
| custom_settings | TEXT | JSON格式的自定义设置 |
| created_at | DATETIME | 创建时间 |

**枚举值说明**:

`message_filter`:
- `all` - 接收所有消息
- `keywords` - 仅接收包含关键词的消息
- `mention` - 仅接收@提及的消息

`conversation_mode`:
- `free` - 自由参与对话
- `mention` - 仅在被@时响应
- `passive` - 被动模式，需用户授权

---

### 5. system_settings - 系统设置表

存储全局系统配置。

```sql
CREATE TABLE system_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,           -- JSON格式值
  description TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

| 字段 | 类型 | 说明 |
|-----|------|------|
| key | TEXT | 设置项键名（主键） |
| value | TEXT | 设置值（JSON格式） |
| description | TEXT | 设置项描述 |
| updated_at | DATETIME | 最后更新时间 |

**默认设置项**:

| key | 默认值 | 说明 |
|-----|-------|------|
| `agent_reply_mode` | `"active"` | Agent回复模式 |
| `agent_cooldown_ms` | `3000` | Agent回复冷却时间(毫秒) |
| `max_consecutive_msg` | `10` | Agent连续消息最大数 |
| `allow_agent_to_agent` | `true` | 允许Agent互相回复 |
| `auth_keywords` | `["继续","请继续","go on","continue","/allow-chat"]` | 授权关键词 |
| `reply_delay_range` | `{"min":500,"max":2000}` | 回复延时范围(毫秒) |

---

### 6. topics - 话题表

存储用户创建的话题。

```sql
CREATE TABLE topics (
  id TEXT PRIMARY KEY,           -- UUID
  title TEXT NOT NULL,           -- 话题标题
  description TEXT,              -- 描述
  created_by TEXT,               -- 创建者ID
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  status TEXT DEFAULT 'active'   -- 状态
)
```

| 字段 | 类型 | 说明 |
|-----|------|------|
| id | TEXT | 话题唯一标识（UUID） |
| title | TEXT | 话题标题 |
| description | TEXT | 话题描述 |
| created_by | TEXT | 创建者用户ID |
| created_at | DATETIME | 创建时间 |
| status | TEXT | 状态：`active` / `archived` |

---

### 7. topic_messages - 话题消息表

存储话题中包含的消息。

```sql
CREATE TABLE topic_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id TEXT NOT NULL,        -- 关联话题ID
  original_message_id TEXT,      -- 原始消息ID
  sender_id TEXT NOT NULL,
  sender_name TEXT NOT NULL,
  sender_type TEXT NOT NULL,
  content TEXT NOT NULL,
  original_created_at TEXT,      -- 原始消息时间
  sequence INTEGER NOT NULL,     -- 序号
  FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE
)
```

| 字段 | 类型 | 说明 |
|-----|------|------|
| id | INTEGER | 自增主键 |
| topic_id | TEXT | 所属话题ID |
| original_message_id | TEXT | 原始消息的ID（来自messages表） |
| sender_id | TEXT | 发送者ID |
| sender_name | TEXT | 发送者名称 |
| sender_type | TEXT | 发送者类型 |
| content | TEXT | 消息内容 |
| original_created_at | TEXT | 原始消息的发送时间 |
| sequence | INTEGER | 消息在话题中的序号 |

**说明**:
- `ON DELETE CASCADE` - 话题删除时，关联消息自动删除

---

### 8. topic_summaries - 话题总结表

存储 AI 生成的话题总结。

```sql
CREATE TABLE topic_summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id TEXT NOT NULL,
  narrative TEXT,                -- 叙事总结
  viewpoints TEXT,               -- 各方观点（JSON数组）
  consensus TEXT,                -- 共识
  open_questions TEXT,           -- 待解决问题（JSON数组）
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE
)
```

| 字段 | 类型 | 说明 |
|-----|------|------|
| id | INTEGER | 自增主键 |
| topic_id | TEXT | 所属话题ID |
| narrative | TEXT | 叙事性总结 |
| viewpoints | TEXT | JSON数组，各方观点列表 |
| consensus | TEXT | 达成的共识 |
| open_questions | TEXT | JSON数组，待解决问题列表 |
| created_at | DATETIME | 总结生成时间 |

---

## 数据关系图

```
┌─────────────┐     ┌─────────────┐
│   users     │     │  sessions   │
├─────────────┤     ├─────────────┤
│ id (PK)     │◄────│ user_id(FK) │
│ username    │     │ id (PK)     │
│ display_name│     └─────────────┘
└─────────────┘
      │
      │ created_by
      ▼
┌─────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   topics    │     │ topic_messages  │     │ topic_summaries │
├─────────────┤     ├─────────────────┤     ├─────────────────┤
│ id (PK)     │◄────│ topic_id (FK)   │◄────│ topic_id (FK)   │
│ title       │     │ original_msg_id │     │ narrative       │
│ description │     │ content         │     │ viewpoints      │
│ status      │     │ sequence        │     │ consensus       │
└─────────────┘     └─────────────────┘     │ open_questions  │
                                           └─────────────────┘

┌─────────────────┐
│ agent_configs   │
├─────────────────┤
│ id (PK)         │
│ name            │
│ token           │
│ persona         │
│ conversation_   │
│   mode          │
└─────────────────┘

┌─────────────────┐
│   messages      │
├─────────────────┤
│ id (PK)         │
│ sender_id       │
│ sender_type     │
│ content         │
│ created_at      │
└─────────────────┘

┌─────────────────┐
│ system_settings │
├─────────────────┤
│ key (PK)        │
│ value (JSON)    │
│ description     │
└─────────────────┘
```

---

## 常用查询

### 获取最近N条消息

```sql
SELECT * FROM messages
ORDER BY created_at DESC
LIMIT 50;
```

### 获取话题及其消息数量

```sql
SELECT t.*, COUNT(tm.id) as message_count
FROM topics t
LEFT JOIN topic_messages tm ON t.id = tm.topic_id
GROUP BY t.id;
```

### 获取在线用户

```sql
-- 在线状态由 WebSocket 连接管理，不存储在数据库
-- sessions 表仅用于认证
```

### 按类型统计消息

```sql
SELECT sender_type, COUNT(*) as count
FROM messages
GROUP BY sender_type;
```

---

## 备份与恢复

### 备份数据库

```bash
cp data/chat.db data/chat.db.backup
```

### 恢复数据库

```bash
cp data/chat.db.backup data/chat.db
```

### 导出为SQL

```bash
# sql.js 使用内存数据库，需要通过 API 导出
# 或者在服务运行时访问 /api/platform/messages 导出消息
```
