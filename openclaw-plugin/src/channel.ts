/**
 * Agent Chat Channel Plugin
 *
 * OpenClaw 频道插件，连接到 Agent Chat 群聊系统
 */

import type { ChannelPlugin, OpenClawConfig } from "openclaw/plugin-sdk";
import { AgentChatGateway, setGateway, getGateway, removeGateway } from "./gateway.js";
import type { AgentChatAccount, AgentChatConfig, AgentChatMessage } from "./types.js";
import { getAgentChatRuntime, setAgentChatRuntime } from "./runtime.js";

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

      ctx.log?.info(`[AgentChat] 启动 account=${ctx.accountId}`);
      ctx.log?.info(`[AgentChat] 连接到 ${account.config.serverUrl}`);

      const runtime = getAgentChatRuntime();

      const gateway = new AgentChatGateway({
        config: account.config,
        abortSignal: ctx.abortSignal,
        log: ctx.log,
        onMessage: async (msg) => {
          // 使用 OpenClaw 的 channel 接口处理消息
          try {
            ctx.log?.info(`[AgentChat] === 开始处理消息 ===`);
            ctx.log?.info(`[AgentChat] runtime.channel 存在: ${!!runtime.channel}`);
            ctx.log?.info(`[AgentChat] runtime.channel.activity 存在: ${!!runtime.channel?.activity}`);
            ctx.log?.info(`[AgentChat] runtime.channel.routing 存在: ${!!runtime.channel?.routing}`);
            ctx.log?.info(`[AgentChat] runtime.channel.reply 存在: ${!!runtime.channel?.reply}`);

            if (runtime.channel?.activity?.record) {
              ctx.log?.info(`[AgentChat] 调用 activity.record`);
              runtime.channel.activity.record({
                channel: "agent-chat",
                accountId: ctx.accountId,
                direction: "inbound",
              });
              ctx.log?.info(`[AgentChat] activity.record 完成`);
            }

            // 解析路由
            let route = { agentId: "main" };
            if (runtime.channel?.routing?.resolveAgentRoute) {
              ctx.log?.info(`[AgentChat] 调用 resolveAgentRoute`);
              route = runtime.channel.routing.resolveAgentRoute({
                cfg: ctx.cfg,
                channel: "agent-chat",
                accountId: ctx.accountId,
                peer: {
                  kind: "group",
                  id: "agent-chat-group",
                },
              }) as { agentId: string };
              ctx.log?.info(`[AgentChat] Route resolved: agentId=${route.agentId}`);
            } else {
              ctx.log?.warn(`[AgentChat] resolveAgentRoute 不可用，使用默认路由`);
            }

            // 组装消息体
            const bodyForAgent = `[${msg.sender_type}] ${msg.sender_name}: ${msg.content}`;
            ctx.log?.info(`[AgentChat] bodyForAgent: ${bodyForAgent}`);

            // 格式化信封
            let envelope: any = { body: bodyForAgent };
            if (runtime.channel?.reply?.formatInboundEnvelope) {
              ctx.log?.info(`[AgentChat] 调用 formatInboundEnvelope`);
              const envelopeOptions = runtime.channel.reply.resolveEnvelopeFormatOptions
                ? runtime.channel.reply.resolveEnvelopeFormatOptions(ctx.cfg)
                : {};

              envelope = runtime.channel.reply.formatInboundEnvelope({
                cfg: ctx.cfg,
                channel: "agent-chat",
                accountId: ctx.accountId,
                peer: {
                  kind: "group",
                  id: "agent-chat-group",
                },
                senderId: msg.sender_id,
                senderName: msg.sender_name,
                body: bodyForAgent,
                envelopeOptions,
              });
              ctx.log?.info(`[AgentChat] Envelope formatted: ${JSON.stringify(envelope).substring(0, 200)}`);
            } else {
              ctx.log?.warn(`[AgentChat] formatInboundEnvelope 不可用`);
            }

            // 最终化上下文
            let finalCtx: any = { envelope };
            if (runtime.channel?.reply?.finalizeInboundContext) {
              ctx.log?.info(`[AgentChat] 调用 finalizeInboundContext`);
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
              ctx.log?.info(`[AgentChat] Context finalized`);
            } else {
              ctx.log?.warn(`[AgentChat] finalizeInboundContext 不可用`);
            }

            // 分发回复
            if (runtime.channel?.reply?.dispatchReplyWithBufferedBlockDispatcher) {
              ctx.log?.info(`[AgentChat] 调用 dispatchReplyWithBufferedBlockDispatcher`);
              await runtime.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
                ctx: finalCtx,
                cfg: ctx.cfg,
                dispatcherOptions: {
                  responsePrefix: "",
                  deliver: async (payload: { text?: string }, info: { kind: string }) => {
                    ctx.log?.info(`[AgentChat] >>> DELIVER CALLBACK <<< kind=${info.kind}`);
                    ctx.log?.info(`[AgentChat] payload.text 长度: ${payload.text?.length || 0}`);
                    ctx.log?.info(`[AgentChat] payload.text 预览: ${payload.text?.substring(0, 100)}...`);

                    // 跳过工具调用的中间结果
                    if (info.kind === "tool") {
                      ctx.log?.info(`[AgentChat] 跳过工具结果`);
                      return;
                    }

                    // 发送回复
                    const replyText = payload.text;
                    if (replyText && replyText.trim()) {
                      const gw = getGateway(ctx.accountId);
                      ctx.log?.info(`[AgentChat] Gateway 获取结果: ${gw ? 'found' : 'not found'}`);
                      if (gw) {
                        const sent = gw.sendMessage(replyText);
                        ctx.log?.info(`[AgentChat] 发送结果: ${sent}, 内容: ${replyText.substring(0, 50)}...`);
                      } else {
                        ctx.log?.warn("[AgentChat] Gateway not found for sending reply");
                      }
                    } else {
                      ctx.log?.warn(`[AgentChat] replyText 为空，跳过发送`);
                    }
                  },
                },
              });
              ctx.log?.info(`[AgentChat] dispatchReplyWithBufferedBlockDispatcher 完成`);
            } else {
              ctx.log?.error(`[AgentChat] !!! dispatchReplyWithBufferedBlockDispatcher NOT AVAILABLE !!!`);
              ctx.log?.error(`[AgentChat] runtime.channel.reply keys: ${runtime.channel?.reply ? Object.keys(runtime.channel.reply).join(', ') : 'null'}`);
            }

            ctx.setStatus({
              accountId: ctx.accountId,
              connected: true,
              lastMessageTime: Date.now(),
            });

            ctx.log?.info(`[AgentChat] === 消息处理完成 ===`);

          } catch (err) {
            ctx.log?.error(`[AgentChat] 处理消息失败: ${err}`);
            ctx.log?.error(`[AgentChat] 错误堆栈: ${(err as Error).stack}`);
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
