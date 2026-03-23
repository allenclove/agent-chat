/**
 * Agent Chat Channel Plugin
 *
 * OpenClaw 频道插件，连接到 Agent Chat 群聊系统
 */

import type { ChannelPlugin, OpenClawConfig } from "openclaw/plugin-sdk";
import { AgentChatGateway, setGateway, getGateway, removeGateway } from "./gateway.js";
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

      ctx.log?.info(`[AgentChat] 启动连接到 ${account.config.serverUrl}`);

      const runtime = getAgentChatRuntime();

      const gateway = new AgentChatGateway({
        config: account.config,
        abortSignal: ctx.abortSignal,
        log: ctx.log,
        onMessage: async (msg) => {
          try {
            // 记录活动
            if (runtime.channel?.activity?.record) {
              runtime.channel.activity.record({
                channel: "agent-chat",
                accountId: ctx.accountId,
                direction: "inbound",
              });
            }

            // 解析路由
            let route = { agentId: "main" };
            if (runtime.channel?.routing?.resolveAgentRoute) {
              route = runtime.channel.routing.resolveAgentRoute({
                cfg: ctx.cfg,
                channel: "agent-chat",
                accountId: ctx.accountId,
                peer: {
                  kind: "group",
                  id: "agent-chat-group",
                },
              }) as { agentId: string };
            }

            // 组装消息体
            const bodyForAgent = `[${msg.sender_type}] ${msg.sender_name}: ${msg.content}`;

            // 创建信封
            const envelope: any = {
              body: bodyForAgent,
              text: msg.content,
              rawText: msg.content,
            };

            // 最终化上下文
            let finalCtx: any = { envelope };
            if (runtime.channel?.reply?.finalizeInboundContext) {
              finalCtx = runtime.channel.reply.finalizeInboundContext({
                cfg: ctx.cfg,
                channel: "agent-chat",
                accountId: ctx.accountId,
                peer: {
                  kind: "group",
                  id: "agent-chat-group",
                },
                senderId: msg.sender_id,
                envelope,
                route,
              });

              // 如果 finalizeInboundContext 没有正确设置 Body，手动设置
              if (!finalCtx.Body && envelope.body) {
                finalCtx.Body = envelope.body;
                finalCtx.BodyForAgent = envelope.body;
              }
            }

            // 分发回复
            if (runtime.channel?.reply?.dispatchReplyWithBufferedBlockDispatcher) {
              await runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
                ctx: finalCtx,
                cfg: ctx.cfg,
                dispatcherOptions: {
                  responsePrefix: "",
                  deliver: async (payload: { text?: string }, info: { kind: string }) => {
                    // 跳过工具调用的中间结果
                    if (info.kind === "tool") {
                      return;
                    }

                    // 发送回复
                    const replyText = payload.text;
                    if (replyText && replyText.trim()) {
                      const gw = getGateway(ctx.accountId);
                      if (gw) {
                        gw.sendMessage(replyText);
                      }
                    }
                  },
                },
              });
            }

            ctx.setStatus({
              accountId: ctx.accountId,
              connected: true,
              lastMessageTime: Date.now(),
            });

          } catch (err) {
            ctx.log?.error(`[AgentChat] 处理消息失败: ${err}`);
          }
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

export default agentChatPlugin;
