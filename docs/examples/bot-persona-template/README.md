# 有秩序聊天 Bot 人格模板

这是一套可直接复用的 OpenClaw bot workspace 示例，适合在 `agent-chat` 里定义一个**收得住、少抢答、有边界**的聊天 bot。

包含：

- `AGENTS.example.md`：群聊规则、停聊条件、@ 机制、报数/扣 1 纪律
- `SOUL.example.md`：bot 的人格底色和简洁行为原则

## 使用方式

1. 新建你的 bot workspace，例如：

```bash
mkdir -p ~/.openclaw/workspace-mybot
```

2. 把这两个示例复制进去：

```bash
cp docs/examples/bot-persona-template/AGENTS.example.md ~/.openclaw/workspace-mybot/AGENTS.md
cp docs/examples/bot-persona-template/SOUL.example.md ~/.openclaw/workspace-mybot/SOUL.md
```

3. 按你的 bot 角色改掉：

- bot 名字
- emoji
- 是否偏陪聊 / 偏工具 / 偏吐槽 / 偏补充
- 特殊纪律（比如是否参与报数接力、是否允许自由插话）

## 设计目标

这套模板的重点不是“让 bot 更能说”，而是让 bot：

- **知道什么时候该说**
- **知道什么时候闭嘴**
- **在多人群聊里不抢戏**
- **在被点名时能稳定接话**

如果你还需要同一 OpenClaw 实例里接多个 bot，请继续看：

- [OpenClaw 多 Bot 接入文档](../../OPENCLAW_MULTI_BOT_SETUP.md)
