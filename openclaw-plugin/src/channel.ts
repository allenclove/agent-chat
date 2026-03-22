/**
 * Agent Chat Channel Plugin
 *
 * OpenClaw 频道插件，连接到 Agent Chat 群聊系统
 */

import type { ChannelPlugin, OpenClawConfig } from "openclaw/plugin-sdk";
import { AgentChatGateway, setGateway, removeGateway } from "./gateway.js";
import type { AgentChatAccount, AgentChatConfig, AgentChatMessage } from "./types.js";
import { getAgentChatRuntime } from "./runtime.js";

const DEFAULT_ACCOUNT_ID = "default";

const meta = {
  id: "agent-chat",
  label: "Agent Chat",
  selectionLabel: "Agent Chat 群聊",
  docsPath: "/docs/channels/agent-chat",
  blurb: "多智能体群聊系统",
  order: 100,
};

// 列出账户ID
function listAccountIds(cfg: OpenClawConfig): string[] {
  const channelConfig = cfg?.channels?.["agent-chat"] as AgentChatConfig | undefined;
  if (!channelConfig) return [];
  return [DEFAULT_ACCOUNT_ID];
}

// 解析账户配置
function resolveAccount(cfg: OpenClawConfig, accountId?: string): AgentChatAccount {
  const channelConfig = cfg?.channels?.["agent-chat"] as AgentChatConfig | undefined;
  const actualAccountId = accountId || DEFAULT_ACCOUNT_ID;

  return {
    accountId: actualAccountId,
    enabled: channelConfig?.enabled !== false,
    configured: !!(channelConfig?.serverUrl && channelConfig?.agentId && channelConfig?.token),
    name: "Agent Chat",
    agentId: channelConfig?.agentId || "openclaw-subagent",
    config: channelConfig || {
      serverUrl: "ws://127.0.0.1:8080",
      agentId: "openclaw-subagent",
      token: "openclaw-subagent-token-2026",
    },
  };
}

// 处理收到的消息，转发给 OpenClaw
async function handleIncomingMessage(
  msg: AgentChatMessage,
  accountId: string
): Promise<void> {
  const runtime = getAgentChatRuntime();

  if (!runtime.channel) {
    console.warn("[AgentChat] runtime.channel 不可用");
    return;
  }

  try {
    const inboundContext = {
      channelId: "agent-chat",
      accountId,
      senderId: msg.sender_id,
      senderName: msg.sender_name,
      senderType: msg.sender_type,
      content: msg.content,
      messageId: String(msg.id),
      timestamp: msg.created_at,
      metadata: {
        platform: msg._platform || "agent-chat-v1",
      },
    };

    if (runtime.channel.handleIncomingMessage) {
      await runtime.channel.handleIncomingMessage(inboundContext);
    }
  } catch (err) {
    console.error("[AgentChat] 处理消息失败:", err);
  }
}

export const agentChatPlugin: ChannelPlugin<AgentChatAccount> = {
  id: "agent-chat",
  meta,

  capabilities: {
    chatTypes: ["group"],
    media: false,
    reactions: false,
    threads: false,
    blockStreaming: false,
  },

  reload: { configPrefixes: ["channels.agent-chat"] },

  config: {
    listAccountIds: (cfg) => listAccountIds(cfg),
    resolveAccount: (cfg, accountId) => resolveAccount(cfg, accountId),
    defaultAccountId: () => DEFAULT_ACCOUNT_ID,
    isConfigured: (account) => Boolean(account?.config?.serverUrl && account?.config?.agentId && account?.config?.token),
    describeAccount: (account) => ({
      accountId: account?.accountId ?? DEFAULT_ACCOUNT_ID,
      name: account?.name ?? "Agent Chat",
      enabled: account?.enabled ?? false,
      configured: account?.configured ?? false,
    }),
  },

  pairing: {
    idLabel: "agentChatUserId",
    normalizeAllowEntry: (entry) => entry,
  },

  setup: {
    resolveAccountId: () => DEFAULT_ACCOUNT_ID,
  },

  messaging: {
    normalizeTarget: (raw) => raw,
    targetResolver: {
      looksLikeId: (id) => typeof id === "string" && id.length > 0,
      hint: "<userId|agentId>",
    },
  },

  directory: {
    self: async () => null,
    listPeers: async () => [],
    listGroups: async () => [],
  },

  outbound: {
    send: async ({ cfg, to, text, accountId }) => {
      const account = resolveAccount(cfg, accountId);

      if (!account.config) {
        return { success: false, error: "Account not configured" };
      }

      const gateway = setGateway(accountId || DEFAULT_ACCOUNT_ID, null as unknown as AgentChatGateway);

      // 直接创建一个简单的发送方法
      const config = account.config;
      const WebSocket = (await import("ws")).default;

      return new Promise((resolve) => {
        try {
          const ws = new WebSocket(config.serverUrl);

          ws.on("open", () => {
            ws.send(JSON.stringify({
              type: "agent_join",
              payload: {
                agent_id: config.agentId,
                token: config.token,
              },
            }));
          });

          ws.on("message", (data) => {
            const msg = JSON.parse(data.toString());
            if (msg.type === "agent_join_ack") {
              ws.send(JSON.stringify({
                type: "message",
                payload: { content: text },
              }));

              setTimeout(() => {
                ws.close();
                resolve({ success: true });
              }, 100);
            }
          });

          ws.on("error", (err) => {
            resolve({ success: false, error: err.message });
          });
        } catch (err) {
          resolve({ success: false, error: String(err) });
        }
      });
    },
  },

  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      connected: false,
      lastMessageTime: null,
      lastError: null,
    },
    buildChannelSummary: ({ snapshot }) => ({
      configured: snapshot?.configured ?? false,
      connected: snapshot?.connected ?? false,
      lastError: snapshot?.lastError ?? null,
    }),
    buildAccountSnapshot: ({ account, runtime }) => ({
      accountId: account?.accountId ?? DEFAULT_ACCOUNT_ID,
      name: account?.name,
      enabled: account?.enabled ?? false,
      configured: account?.configured ?? false,
      agentId: account?.agentId,
      connected: runtime?.connected ?? false,
      lastError: runtime?.lastError ?? null,
    }),
  },

  gateway: {
    startAccount: async (ctx) => {
      const account = resolveAccount(ctx.cfg, ctx.accountId);

      if (!account.config) {
        ctx.log?.error("[AgentChat] 配置缺失");
        return;
      }

      ctx.log?.info(`[AgentChat] 启动 account=${ctx.accountId}`);
      ctx.log?.info(`[AgentChat] 连接到 ${account.config.serverUrl}`);

      const gateway = new AgentChatGateway({
        config: account.config,
        abortSignal: ctx.abortSignal,
        log: ctx.log,
        onMessage: async (msg) => {
          await handleIncomingMessage(msg, ctx.accountId);
          ctx.setStatus({
            accountId: ctx.accountId,
            connected: true,
            lastMessageTime: Date.now(),
          });
        },
      });

      setGateway(ctx.accountId, gateway);

      ctx.setStatus({
        accountId: ctx.accountId,
        connected: false,
      });

      await gateway.start();

      await new Promise<void>((resolve) => {
        ctx.abortSignal.addEventListener("abort", () => {
          gateway.stop();
          removeGateway(ctx.accountId);
          resolve();
        });
      });
    },
  },
};
