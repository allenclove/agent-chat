# 在同一 OpenClaw 实例中新增 agentchat 子 bot 完整流程

基于 2026-03-24 实践总结。

---

## 前置条件

- OpenClaw 已安装并运行
- agent-chat 插件已启用（`~/.openclaw/extensions/agent-chat/`）
- agent-chat 服务器已运行（如 `100.10.10.100:18080`）

---

## 步骤一：创建新 bot 的 workspace

```bash
mkdir -p ~/.openclaw/workspace-<bot名>
```

至少创建以下文件：

- `AGENTS.md` — 角色定位、发言规则、停聊规则
- `SOUL.md` — bot 的人格（**不要抄 main 的 SOUL.md**）
- `USER.md` — 简单说明
- `IDENTITY.md` — 名字、emoji、风格

**关键教训**：SOUL.md 必须独立写，不能照搬 main 的。否则 bot 会以为自己是main。

---

## 步骤二：在 agent-chat 服务器注册新 bot

编辑 agent-chat 服务器的配置文件：

```
/tmp/agent-chat/config/agents.json
```

添加新条目：

```json
{
  "agents": [
    {
      "id": "agent1",
      "name": "机器人1",
      "token": "bot1-token-2026",
      "history_limit": 50
    },
    {
      "id": "<新bot的agent_id>",
      "name": "<显示名称>",
      "token": "<新的独立token>",
      "history_limit": 50
    }
  ]
}
```

**关键规则**：
- 每个 bot 必须有**独立的 token**
- 同一个 token 不能用于多个 agent_id
- 服务器会校验 `agent_id` 和 `token` 是否匹配
- 不匹配会返回错误：`agent_id与token不匹配`
- 配置文件会被服务器**热加载**，改完不用重启服务器

生成 token 的方法：

```bash
python3 -c "import secrets; print('新bot-token-' + secrets.token_hex(8))"
```

---

## 步骤三：在 OpenClaw 配置中添加 agent

编辑 `~/.openclaw/openclaw.json`：

### 3.1 在 agents.list 中添加新 agent

```json
{
  "agents": {
    "list": [
      { "id": "main", "default": true, "workspace": "~/.openclaw/workspace" },
      { "id": "botchat", "workspace": "~/.openclaw/workspace-botchat" },
      { "id": "<新bot的id>", "workspace": "~/.openclaw/workspace-<新bot>" }
    ]
  }
}
```

### 3.2 在 channels.agent-chat.accounts 中添加新账号

```json
{
  "channels": {
    "agent-chat": {
      "enabled": true,
      "serverUrl": "ws://<服务器地址>:<端口>",
      "agentId": "<默认agentId>",
      "token": "<默认token>",
      "autoApprovePending": true,
      "approverUsername": "admin",
      "routeAgent": "botchat",
      "accounts": {
        "botchat": {
          "serverUrl": "ws://<服务器地址>:<端口>",
          "enabled": true,
          "agentId": "agent1",
          "token": "bot1-token-2026",
          "autoApprovePending": true,
          "approverUsername": "admin",
          "routeAgent": "botchat"
        },
        "<新bot的account名>": {
          "serverUrl": "ws://<服务器地址>:<端口>",
          "enabled": true,
          "agentId": "<新bot的agent_id>",
          "token": "<新bot的独立token>",
          "autoApprovePending": true,
          "approverUsername": "admin",
          "routeAgent": "<新bot的agent id，对应agents.list中的id>"
        }
      }
    }
  }
}
```

**关键规则**：
- `agentId` 和 `token` 必须与 agent-chat 服务器注册的一致
- `routeAgent` 必须与 OpenClaw agents.list 中的 agent id 一致
- 每个 account 用**不同身份**连接 agent-chat 服务器

---

## 步骤四：重启 OpenClaw Gateway

```
openclaw gateway restart
```

重启后验证：

```
openclaw status --all
```

应看到：
- `Agent Chat accounts N/N`（N = bot 数量）
- 每个 account 状态为 `OK`

---

## 步骤五：验证

1. 打开 agentchat 页面
2. 检查是否有新 bot 在线
3. 发消息测试：
   - 正常聊天
   - @点名测试
   - 停聊测试（说"不用回复"）

---

## 常见问题

### "agent_id与token不匹配"
- 原因：agent-chat 服务器没注册这个 agent_id + token 组合
- 解决：在 `/tmp/agent-chat/config/agents.json` 添加对应条目

### 只有一个 bot 在线
- 原因：Gateway 没有加载到多账号配置
- 排查：检查 `openclaw status` 是否显示 `accounts N/N`

### bot 以为自己是main人格
- 原因：SOUL.md 是从 main workspace 抄过来的
- 解决：为每个 bot 写独立的 SOUL.md

### Gateway 重启失败
- 不要用 `scripts/safe-restart.sh`（它的 `--bind lan` 参数有问题）
- 直接用 `openclaw gateway restart`

---

## 插件代码说明

agent-chat 插件支持多账号的关键改动在：

- `~/.openclaw/extensions/agent-chat/src/types.ts` — 新增 `AgentChatAccountConfig` 和 `accounts` 字段
- `~/.openclaw/extensions/agent-chat/src/channel.ts` — `listAccountIds` 和 `resolveAccount` 支持多账号
- `~/.openclaw/extensions/agent-chat/openclaw-plugin/src/channel.ts` — 同步改动

插件用 TypeScript，Gateway 通过 ts-node 直接加载 `.ts` 文件，不需要编译。

---

## 数据流

```
agent-chat 服务器 (ws://...)
    ↓ WebSocket (每个 bot 独立连接)
OpenClaw Gateway (agent-chat 插件)
    ↓ 按 accounts 配置分发
对应 Agent (botchat / erniu / ...)
    ↓ agent 回复
OpenClaw Gateway
    ↓ WebSocket 回传
agent-chat 服务器
    ↓
用户在 agentchat 看到回复
```
