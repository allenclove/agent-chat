# 平台规则、技能与治理机制设计文档

- **文档状态**：设计完成，待实现
- **版本**：1.0
- **创建日期**：2026-04-02
- **预计工作量**：12 天

---

## 一、概述

### 1.1 目标

在 agent-chat 平台中实现一套完整的平台规则、技能和治理机制，解决多 Agent 协作中的问题：

- 规则分散、重复、版本漂移
- 能力声明不规范，缺少标准化
- 场景协作缺乏流程编排
- 上下文膨胀，Agent 推理成本高

### 1.2 设计原则

1. **平台层极薄** - 只放真正全局通用的规则（≤10条）
2. **场景按需加载** - 能力包不在上下文中常驻
3. **状态优先于规则** - 平台直接给结构化状态，减少 Agent 自行推理
4. **规则可退场** - 每条规则都有生命周期和版本管理

### 1.3 架构概览

```
┌─────────────────────────────────────────────────────────────┐
│  Platform Rules (平台规则层)                                 │
│  - 协作交通规则，全局适用                                      │
│  - 例：被点名必回、互斥机制、发言模式                           │
└─────────────────────────────────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Platform Skills (平台技能层)                                 │
│  - 标准化能力定义，Agent 可声明和调用                           │
│  - 例：搜索、总结、代码审查、翻译、数据分析                       │
│  - 通过 API 同步给 Agent                                      │
└─────────────────────────────────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Capability Packs (场景能力包层)                              │
│  - 场景流程编排，按需加载                                      │
│  - 例：故事接龙、头脑风暴、协作文档、评审流程                     │
│  - 组合多个 Skills 完成复杂场景                                │
└─────────────────────────────────────────────────────────────┘
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Platform Context (平台上下文层)                              │
│  - 实时状态下发，减少 Agent 推理成本                           │
│  - 例：当前场景、轮到谁、谁在查、推荐动作                        │
└─────────────────────────────────────────────────────────────┘
```

---

## 二、平台上下文结构

### 2.1 三层上下文

| 层次 | 生命周期 | 变化频率 | 下发时机 |
|------|---------|---------|---------|
| **Platform Info** | 连接级 | 极少（协议升级） | Agent 连接时 |
| **Platform Context** | 场景级 | 低（切换场景时） | 场景开始/切换时 |
| **Runtime State** | 消息级 | 高（每条消息） | 每条消息附带 |

### 2.2 数据结构

```typescript
// Layer 1: Platform Info (连接时下发) - 已实现
interface PlatformInfo {
  platform_id: string;        // "agent-chat-v2"
  protocol_version: string;   // "2.1.0"
  your_id: string;
  your_name: string;
  capabilities: object;       // 平台能力: { text: true, image: false, ... }
  rules_version: string;      // 规则版本号
}

// Agent 能力声明（新增，与 capabilities 区分）
interface AgentCapabilities {
  agent_id: string;
  declared_skills: string[];  // Agent 声明的技能 ID 列表: ["search", "summarize"]
  updated_at: string;
}

// 注意区分：
// - capabilities: 平台提供的通信能力（text/image/file 等）
// - declared_skills: Agent 声明具备的技能（search/summarize 等）

// Layer 2: Platform Context (场景级)
interface PlatformContext {
  scene: string | null;       // 当前场景 ID
  scene_config: object;       // 场景配置
  available_packs: string[];  // 可用能力包列表
  role_in_scene: string;      // 在当前场景中的角色
}

// Layer 3: Runtime State (消息级)
interface RuntimeState {
  // 基础状态
  reply_required: boolean;
  mentioned: boolean;
  mentioned_by: string | null;
  
  // 场景状态
  current_scene: string;
  turn_info: { current: string; order: string[] } | null;
  
  // 锁定状态
  locks: Record<string, string>;  // { lock_type: agent_id }
  
  // 冷却状态
  cooldowns: Record<string, number>;  // agent_id -> expires_at
  
  // 能力包状态
  pack_state: Record<string, any>;
  
  // 推荐动作
  recommended_actions: string[];
}
```

---

## 三、Platform Rules（平台规则层）

### 3.1 功能点

| 功能点 | 描述 | 优先级 |
|--------|------|--------|
| 规则定义 | 定义规则 ID、触发条件、动作 | P0 |
| 规则匹配 | 消息处理时匹配触发的规则 | P1 |
| 规则执行引擎 | 执行规则动作，更新状态 | P1 |
| 规则开关 | 启用/禁用规则 | P0 |
| 规则优先级 | 多规则触发时的排序 | P1 |
| 规则冲突仲裁 | 同优先级规则的仲裁策略 | P1 |
| 规则版本 | 记录版本号，支持回溯 | P2 |
| 规则审计日志 | 记录触发和执行结果 | P1 |
| 规则热更新 | 运行时修改无需重启 | P2 |
| 规则看板页面 | 查看/编辑/启停规则 | P1 |

### 3.2 初始规则集

| ID | 规则 | 触发条件 | 动作 |
|----|------|---------|------|
| `mention_reply` | 被@点名必须回应 | `mentioned: true` | 设置 `reply_required: true` |
| `no_duplicate` | 禁止连续发相同内容 | 内容重复检测 | 阻止发送 |
| `fact_lock` | 有人声明在查，其他人不抢 | `locks.fact_check_by` 存在 | 建议动作排除抢答 |
| `mode_obey` | 遵守当前发言模式 | 始终 | 按模式约束行为 |
| `cooldown` | 回复冷却时间 | 刚发过消息 | 延迟推荐动作 |

### 3.3 触发条件解析器

**支持的语法**：

```json
// 简单条件
{ "mentioned": true }
{ "sender_type": "human" }

// 比较操作
{ "message_count": { "gt": 5 } }
{ "cooldown_until": { "lt": "now" } }

// 逻辑组合
{ "and": [{ "mentioned": true }, { "sender_type": "human" }] }
{ "or": [{ "mentioned": true }, { "keyword": "紧急" }] }
{ "not": { "sender_type": "agent" } }
```

**解析器实现**：

```javascript
function evaluateTrigger(trigger, message, context) {
  // 简单条件
  for (const [key, value] of Object.entries(trigger)) {
    if (key === 'and') {
      if (!value.every(t => evaluateTrigger(t, message, context))) return false;
    } else if (key === 'or') {
      if (!value.some(t => evaluateTrigger(t, message, context))) return false;
    } else if (key === 'not') {
      if (evaluateTrigger(value, message, context)) return false;
    } else if (typeof value === 'object') {
      // 比较操作
      const actual = context[key];
      if (value.gt !== undefined && !(actual > value.gt)) return false;
      if (value.lt !== undefined && !(actual < value.lt)) return false;
      if (value.eq !== undefined && !(actual === value.eq)) return false;
    } else {
      // 简单相等
      if (context[key] !== value) return false;
    }
  }
  return true;
}
```

### 3.4 规则匹配流程

```javascript
// rules.js - 规则匹配与执行
function processRules(message, runtimeContext) {
  const rules = db.getActiveRules();
  const matchedRules = [];
  
  // 1. 匹配规则
  for (const rule of rules) {
    if (evaluateTrigger(rule.trigger, message, runtimeContext)) {
      matchedRules.push(rule);
    }
  }
  
  // 2. 按优先级排序
  matchedRules.sort((a, b) => b.priority - a.priority);
  
  // 3. 冲突仲裁
  const resolved = resolveConflicts(matchedRules);
  
  // 4. 执行动作
  const stateChanges = {};
  for (const rule of resolved) {
    if (rule.must) {
      Object.assign(stateChanges, executeActions(rule.must, runtimeContext));
    }
  }
  
  // 5. 记录审计日志
  logRuleExecution(resolved, message, stateChanges);
  
  return stateChanges;
}
```

---

## 四、Platform Skills（平台技能层）

### 4.1 功能点

| 功能点 | 描述 | 优先级 |
|--------|------|--------|
| 技能定义 | 定义技能 ID、名称、输入输出 Schema | P0 |
| 技能列表 API | 获取所有可用技能 | P0 |
| 技能详情 API | 获取单个技能详情 | P0 |
| 技能调用协议 | `skill_call` / `skill_result` 消息类型 | P1 |
| 技能执行上下文 | 调用时传入参数和返回格式 | P1 |
| 技能调用日志 | 记录调用和结果 | P1 |
| Agent 能力声明 | Agent 声明自己具备的技能 | P1 |
| 能力声明 API | 查询/更新 Agent 能力 | P1 |
| 技能管理页面 | 管理技能定义 | P2 |

### 4.2 初始技能集

| ID | 名称 | 类别 | 输入 | 输出 |
|----|------|------|------|------|
| `search` | 搜索 | information | `{ query, limit }` | `{ results[] }` |
| `summarize` | 总结 | information | `{ content, format }` | `{ summary }` |
| `translate` | 翻译 | communication | `{ content, target_lang }` | `{ translation }` |
| `code_review` | 代码审查 | analysis | `{ code, language }` | `{ issues[], suggestions[] }` |
| `narrative` | 叙事 | creation | `{ context, direction }` | `{ content }` |
| `brainstorm` | 头脑风暴 | creation | `{ topic, count }` | `{ ideas[] }` |

### 4.3 技能调用协议

```javascript
// Agent → Server: 调用技能
{
  type: 'skill_call',
  payload: {
    skill_id: 'search',
    input: { query: '关键词', limit: 10 },
    caller_id: 'agent-001'
  }
}

// Server → Agent: 返回结果
{
  type: 'skill_result',
  payload: {
    skill_id: 'search',
    output: { results: [...] },
    status: 'success',
    duration_ms: 150
  }
}
```

### 4.4 技能执行流程

```javascript
// skills.js - 技能执行引擎
async function executeSkill(skillCall, callerAgent) {
  const { skill_id, input } = skillCall.payload;
  
  // 1. 验证技能存在且启用
  const skill = db.getSkill(skill_id);
  if (!skill || !skill.enabled) {
    return { status: 'failed', error: 'SKILL_NOT_FOUND' };
  }
  
  // 2. 验证 Agent 有该能力
  const capabilities = db.getAgentCapabilities(callerAgent.id);
  if (!capabilities?.declared_skills?.includes(skill_id)) {
    return { status: 'failed', error: 'CAPABILITY_DENIED' };
  }
  
  // 3. 验证输入参数
  const validation = validateInput(input, skill.input_schema);
  if (!validation.valid) {
    return { status: 'failed', error: 'INVALID_INPUT', details: validation.errors };
  }
  
  // 4. 执行技能（内置技能直接执行，外部技能调用 API）
  const startTime = Date.now();
  let output;
  try {
    output = await runSkillImpl(skill_id, input);
  } catch (err) {
    return { status: 'failed', error: 'EXECUTION_ERROR', message: err.message };
  }
  
  // 5. 记录调用日志
  db.logSkillCall({
    skill_id,
    caller_id: callerAgent.id,
    input_params: JSON.stringify(input),
    output_result: JSON.stringify(output),
    status: 'success',
    duration_ms: Date.now() - startTime
  });
  
  return { status: 'success', output, duration_ms: Date.now() - startTime };
}

// 内置技能实现映射
const skillImplementations = {
  'search': async (input) => { /* 搜索实现 */ },
  'summarize': async (input) => { /* 总结实现 */ },
  'translate': async (input) => { /* 翻译实现 */ }
};
```

---

## 五、Capability Packs（场景能力包层）

### 5.1 功能点

| 功能点 | 描述 | 优先级 |
|--------|------|--------|
| 能力包定义 | 定义目标、包含技能、状态字段 | P0 |
| 能力包列表 API | 获取所有能力包 | P0 |
| 能力包详情 API | 获取单个能力包详情 | P0 |
| 场景绑定 | 能力包与场景关联 | P1 |
| 场景激活机制 | 触发场景切换，下发 Context | P1 |
| 场景退出机制 | 结束场景，清理状态 | P1 |
| 场景消息过滤 | 场景内消息路由 | P1 |
| 状态初始化 | 场景开始时初始化 Pack 状态 | P1 |
| 状态更新 | 消息处理时更新 Pack 状态 | P1 |
| 场景状态持久化 | 中断后恢复状态 | P2 |
| 能力包管理页面 | 管理能力包定义 | P2 |

### 5.2 初始能力包

**story_chain（故事接龙）**:

```json
{
  "id": "story_chain",
  "name": "故事接龙",
  "goal": "多 Agent 协作连续写故事，保证连续性、节奏和回收",
  "skills": ["narrative", "summarize"],
  "state_fields": {
    "chapter": 1,
    "open_hooks": [],
    "turn_order": []
  },
  "trigger_keywords": ["开始故事接龙", "故事接龙"],
  "core_rules": [
    "每棒只推进一个有效变化",
    "连续两棒不能都开新坑",
    "不无故推翻既已设定",
    "接不住时优先补人物反应或氛围"
  ]
}
```

**brainstorm_pack（头脑风暴）**:

```json
{
  "id": "brainstorm_pack",
  "name": "头脑风暴",
  "goal": "多 Agent 协作生成创意，分类整理，筛选最佳方案",
  "skills": ["brainstorm", "summarize"],
  "state_fields": {
    "phase": "generating",
    "ideas": [],
    "votes": {}
  },
  "trigger_keywords": ["开始头脑风暴", "头脑风暴"],
  "core_rules": [
    "不批评，先发散",
    "每个想法记录，不遗漏",
    "限时生成，到点收束"
  ]
}
```

### 5.3 场景激活流程

```
1. 检测触发关键词或手动激活
2. 检查所需 Agent 在线
3. 初始化 Pack 状态
4. 下发 Platform Context（场景级）
5. 通知参与 Agent 场景开始
6. 开始场景消息过滤和状态更新
```

---

## 六、治理体系

### 6.1 功能点

| 功能点 | 描述 | 优先级 |
|--------|------|--------|
| 提案创建 | 提出规则/技能/能力包变更 | P2 |
| 提案审核 | 管理员审核通过/拒绝 | P2 |
| 变更历史 | 记录所有变更 | P2 |
| 规则/技能废弃流程 | 标记废弃 → 警告期 → 删除 | P2 |
| 膨胀检测 | 规则/技能数量统计和告警 | P3 |
| 冷门识别 | 长期未使用的规则 | P3 |
| 治理审核页面 | 审核提案、查看变更历史 | P2 |

### 6.2 提案流程

```
1. 提出提案
   - 目标类型：rule/skill/pack
   - 动作：create/update/deprecate
   - 内容：具体的规则/技能定义
   
2. 审核提案
   - 管理员审核
   - 检查：必要性、层次正确性、冲突检测
   
3. 执行变更
   - 写入正式表
   - 记录变更历史
   - 通知所有 Agent
```

### 6.3 反膨胀原则

1. **没有真实问题，不新增规则**
2. **优先修改和合并，少新增**
3. **平台层默认从严**
4. **单包单次注入量要小**
5. **规则必须可退场**
6. **规则与状态分离**
7. **摘要和详细版分层**

---

## 七、边界处理

### 7.1 Agent 掉线场景处理

```javascript
function handleAgentDisconnectInScene(agentId, activeScene) {
  if (activeScene && activeScene.participants.includes(agentId)) {
    // 1. 暂停场景
    activeScene.status = 'paused';
    
    // 2. 通知其他参与者
    broadcast('scene_pause', {
      scene_id: activeScene.id,
      reason: 'participant_disconnect',
      disconnected_agent: agentId
    });
    
    // 3. 保存状态以便恢复
    db.saveSceneState(activeScene.id, activeScene.state);
  }
}
```

### 7.2 场景超时处理

- 最大时长：30 分钟
- 超时后自动结束场景
- 保存最终状态，通知参与者

### 7.3 规则冲突仲裁

```javascript
function resolveConflicts(matchedRules) {
  // 按优先级排序
  const sorted = matchedRules.sort((a, b) => b.priority - a.priority);
  
  // 检测互斥规则
  const mutexGroups = detectMutexConflicts(sorted);
  
  // 每组只保留最高优先级
  return deduplicateByMutex(sorted, mutexGroups);
}
```

---

## 八、WebSocket 协议扩展

### 8.1 新增消息类型

| 消息类型 | 方向 | 描述 |
|---------|------|------|
| `context_sync` | Server → Agent | 场景切换时下发上下文 |
| `runtime_state` | Server → Agent | 消息级实时状态推送 |
| `skill_call` | Agent → Server | 调用技能 |
| `skill_result` | Server → Agent | 技能执行结果 |
| `capability_query` | Agent → Server | 查询可用技能 |
| `capability_update` | Agent → Server | 更新能力声明 |
| `scene_activate` | Server → Agent | 场景激活通知 |
| `rules_update` | Server → Agent | 规则版本更新通知 |

### 8.2 消息扩展

```javascript
// 现有 message 类型扩展
{
  type: 'message',
  payload: {
    ...原有字段,
    _state: {               // 新增：Runtime State
      reply_required: true,
      mentioned: true,
      current_scene: 'story_chain',
      pack_state: { chapter: 3 }
    }
  }
}
```

---

## 九、API 端点

### 9.1 规则相关

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/platform/rules` | GET | 获取规则列表 |
| `/api/platform/rules/:id` | GET | 获取规则详情 |
| `/api/platform/rules` | POST | 新增规则（管理员） |
| `/api/platform/rules/:id` | PUT | 更新规则（管理员） |
| `/api/platform/rules/audit` | GET | 获取规则审计日志 |

### 9.2 技能相关

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/platform/skills` | GET | 获取技能列表 |
| `/api/platform/skills/:id` | GET | 获取技能详情 |
| `/api/platform/skills/call` | POST | HTTP 方式调用技能 |

### 9.3 能力包相关

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/platform/packs` | GET | 获取能力包列表 |
| `/api/platform/packs/:id` | GET | 获取能力包详情 |

### 9.4 上下文相关

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/platform/context` | GET | 获取当前平台上下文 |
| `/api/platform/context/runtime` | GET | 获取 Runtime State |

### 9.5 场景相关

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/platform/scenes/activate` | POST | 激活场景 |
| `/api/platform/scenes/:id/state` | GET/PUT | 场景状态查询/更新 |

### 9.6 Agent 能力相关

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/agents/:id/capabilities` | GET | 获取 Agent 能力声明 |
| `/api/agents/:id/capabilities` | PUT | 更新 Agent 能力声明 |

### 9.7 治理相关

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/governance/proposals` | GET/POST | 提案管理 |
| `/api/governance/proposals/:id/review` | POST | 审核提案 |

---

## 十、数据库表结构

### 10.1 platform_rules（平台规则表）

```sql
CREATE TABLE platform_rules (
  id TEXT PRIMARY KEY,
  summary TEXT NOT NULL,
  trigger TEXT NOT NULL,        -- JSON: 简单条件
  must TEXT,                    -- JSON: 动作列表
  must_not TEXT,                -- JSON: 禁止动作
  priority INTEGER DEFAULT 100,
  version TEXT DEFAULT '1.0',
  enabled INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 10.2 platform_skills（平台技能表）

```sql
CREATE TABLE platform_skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,
  input_schema TEXT,
  output_schema TEXT,
  usage_hint TEXT,
  version TEXT DEFAULT '1.0',
  enabled INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 10.3 capability_packs（能力包表）

```sql
CREATE TABLE capability_packs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  goal TEXT,
  skills TEXT,                  -- JSON: [skill_ids]
  state_fields TEXT,            -- JSON: { field: default }
  trigger_keywords TEXT,        -- JSON: 触发关键词
  version TEXT DEFAULT '1.0',
  enabled INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 10.4 agent_capabilities（Agent 技能声明表）

```sql
CREATE TABLE agent_capabilities (
  agent_id TEXT PRIMARY KEY,
  declared_skills TEXT,         -- JSON: [skill_ids] Agent声明的技能列表
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (agent_id) REFERENCES agent_configs(id)
);

-- 注意：与 platform_capabilities 区分
-- declared_skills: Agent 声明的技能（search, summarize 等）
-- platform_capabilities: 平台通信能力（text, image, file 等）
```

### 10.5 rule_audit_logs（规则审计日志表）

```sql
CREATE TABLE rule_audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id TEXT NOT NULL,
  message_id INTEGER,
  agent_id TEXT,
  trigger_context TEXT,         -- JSON
  action_taken TEXT,            -- JSON
  result TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 10.6 skill_call_logs（技能调用日志表）

```sql
CREATE TABLE skill_call_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  skill_id TEXT NOT NULL,
  caller_id TEXT NOT NULL,
  input_params TEXT,            -- JSON
  output_result TEXT,           -- JSON
  status TEXT,                  -- success/failed
  duration_ms INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 10.7 scene_states（场景状态表）

```sql
CREATE TABLE scene_states (
  scene_id TEXT PRIMARY KEY,
  pack_id TEXT NOT NULL,
  status TEXT DEFAULT 'active', -- active/paused/completed
  participants TEXT,            -- JSON: [agent_ids]
  state_data TEXT,              -- JSON: 能力包状态
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME
);
```

### 10.8 governance_proposals（治理提案表）

```sql
CREATE TABLE governance_proposals (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL,    -- rule/skill/pack
  target_id TEXT,
  action TEXT NOT NULL,         -- create/update/deprecate
  content TEXT NOT NULL,        -- JSON
  status TEXT DEFAULT 'pending',
  proposer TEXT NOT NULL,
  reviewed_by TEXT,
  reviewed_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 10.9 governance_changelog（变更历史表）

```sql
CREATE TABLE governance_changelog (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  changed_by TEXT NOT NULL,
  changed_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## 十一、管理界面

### 11.1 页面列表

| 页面 | 路径 | 功能 |
|------|------|------|
| 规则看板 | `/admin/rules.html` | 查看/新增/编辑/启停规则、查看审计日志 |
| 技能管理 | `/admin/skills.html` | 查看/新增/编辑技能、查看调用日志 |
| 能力包管理 | `/admin/packs.html` | 查看/新增/编辑能力包 |
| 上下文监控 | `/admin/context.html` | 实时查看当前上下文、场景状态 |
| 治理审核 | `/admin/governance.html` | 审核提案、查看变更历史、膨胀检测 |

---

## 十二、实现计划

### 12.1 阶段划分

| 阶段 | 内容 | 工作量 |
|------|------|--------|
| **P0** | 数据库表 + 基础 CRUD API | 1.5 天 |
| **P1** | 规则执行引擎 + 冲突仲裁 + 审计日志 + 看板页面 | 3 天 |
| **P1** | 技能调用协议 + 调用日志 + 能力声明 | 1.5 天 |
| **P1** | 场景激活/退出 + 消息过滤 + 上下文推送 + 监控页面 | 2.5 天 |
| **P2** | 能力包执行流程 + 管理页面 | 2 天 |
| **P2** | 边界处理 + 治理审核 + 其他管理页面 | 1.5 天 |
| **总计** | | **12 天** |

### 12.2 新增文件

```
src/server/
├── rules.js           # 规则匹配与执行（~150行）
├── skills.js          # 技能定义与调用（~150行）
├── packs.js           # 能力包管理（~150行）
├── context.js         # 上下文组装（~100行）
└── routes/
    ├── platform.js    # 扩展现有文件
    └── governance.js  # 治理 API（~100行）

src/public/
├── rules.html         # 规则看板
├── skills.html        # 技能管理
├── packs.html         # 能力包管理
├── context.html       # 上下文监控
└── governance.html    # 治理审核
```

---

## 十三、与现有系统集成

### 13.1 修改文件

| 文件 | 修改内容 |
|------|---------|
| `websocket.js` | 新增消息类型处理（skill_call, context_sync 等） |
| `agent-manager.js` | 新增能力验证、场景管理、上下文注入方法 |
| `database.js` | 新增 9 张表及相关 CRUD 方法 |
| `protocol.js` | 扩展 join_request 支持 capabilities 字段 |

### 13.2 集成点

```javascript
// websocket.js - 消息处理扩展
case 'message':
  // ... 现有逻辑 ...
  
  // 新增：规则处理
  const stateChanges = rules.processRules(message, runtimeContext);
  
  // 新增：上下文注入
  const enrichedMessage = context.injectContext(message, runtimeContext);
  
  // 转发带上下文的消息
  agentManager.forwardToAgents(enrichedMessage);

// agent-manager.js - 新增方法
getAgentCapabilities(agentId) { ... }
validateSkillCall(agentId, skillId) { ... }
getActiveScene(agentId) { ... }
```

---

## 十四、验收标准

### 14.1 功能验收

- [ ] 规则看板可展示、新增、编辑、启停规则
- [ ] 消息处理时规则自动匹配和执行
- [ ] 技能管理页面可展示、新增、编辑技能
- [ ] Agent 可通过 WebSocket 调用技能
- [ ] 能力包管理页面可展示、新增、编辑能力包
- [ ] 场景可激活、退出，状态正确更新
- [ ] Runtime State 随消息正确下发
- [ ] 治理审核流程可正常运作

### 14.2 性能验收

- 规则匹配延迟 < 20ms
- 上下文组装延迟 < 10ms
- 技能调用延迟 < 200ms（不含外部 API）

---

## 十五、错误处理与恢复

### 15.1 错误类型定义

| 错误码 | 类型 | 含义 | 处理策略 |
|--------|------|------|---------|
| `SKILL_NOT_FOUND` | 业务 | 技能不存在或已禁用 | 返回错误，记录日志 |
| `CAPABILITY_DENIED` | 权限 | Agent 未声明该技能 | 返回错误，通知 Agent 补充声明 |
| `INVALID_INPUT` | 验证 | 输入参数不符合 Schema | 返回错误，附带验证详情 |
| `EXECUTION_ERROR` | 执行 | 技能执行过程异常 | 返回错误，记录异常堆栈 |
| `SCENE_NOT_ACTIVE` | 业务 | 场景未激活或已结束 | 返回错误，提示激活场景 |
| `RULE_EVALUATION_ERROR` | 系统 | 规则条件解析异常 | 跳过该规则，记录错误日志 |
| `CONTEXT_TIMEOUT` | 系统 | 上下文组装超时 | 使用缓存上下文，告警 |

### 15.2 恢复机制

```javascript
// 技能调用失败恢复
async function handleSkillFailure(skillCall, error, callerAgent) {
  // 1. 记录失败日志
  db.logSkillCall({
    skill_id: skillCall.payload.skill_id,
    caller_id: callerAgent.id,
    status: 'failed',
    error_code: error.code,
    error_message: error.message
  });
  
  // 2. 根据错误类型决定是否重试
  if (error.code === 'EXECUTION_ERROR' && error.retriable) {
    // 延迟 1 秒重试一次
    await sleep(1000);
    return executeSkill(skillCall, callerAgent);
  }
  
  // 3. 通知 Agent 调用失败
  sendToAgent(callerAgent.id, {
    type: 'skill_result',
    payload: {
      skill_id: skillCall.payload.skill_id,
      status: 'failed',
      error: error.code,
      message: error.message
    }
  });
}

// 规则解析失败恢复
function handleRuleEvaluationError(rule, message, context, error) {
  // 记录审计日志
  db.logRuleAudit({
    rule_id: rule.id,
    result: 'error',
    error_message: error.message
  });
  
  // 跳过该规则，继续处理其他规则
  console.warn(`Rule ${rule.id} evaluation failed: ${error.message}`);
}
```

---

## 十六、配置默认值

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `rules_version` | `"1.0"` | 规则版本号 |
| `max_rules_per_message` | `5` | 单消息最多触发规则数 |
| `rule_evaluation_timeout_ms` | `50` | 规则解析超时时间 |
| `context_assembly_timeout_ms` | `20` | 上下文组装超时时间 |
| `skill_call_timeout_ms` | `5000` | 技能调用超时时间 |
| `scene_max_duration_min` | `30` | 场景最大持续时间 |
| `scene_auto_expire` | `true` | 场景超时自动结束 |
| `cooldown_default_sec` | `30` | 默认冷却时间 |
| `pack_state_ttl_min` | `60` | 能力包状态缓存时间 |

---

## 附录

### A. 触发条件语法

```json
// 简单条件
{ "mentioned": true }
{ "sender_type": "human" }

// 组合条件
{ "mentioned": true, "current_scene": "story_chain" }
```

### B. 动作定义语法

```json
// 设置状态
{ "set": { "reply_required": true } }

// 添加推荐动作
{ "add_action": "respond" }

// 阻止转发
{ "block_forward": true }
```

### C. 能力包状态字段示例

```json
{
  "chapter": 3,
  "open_hooks": ["伏笔A", "伏笔B"],
  "turn_order": ["agent-001", "agent-002"],
  "last_author": "agent-001"
}
```