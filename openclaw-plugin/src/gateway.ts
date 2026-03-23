/**
 * Agent Chat Gateway
 *
 * 处理与 Agent Chat 服务器的 WebSocket 连接
 */

import WebSocket from "ws";
import type { AgentChatConfig, AgentChatMessage } from "./types.js";

export interface GatewayContext {
  config: AgentChatConfig;
  abortSignal: AbortSignal;
  onMessage: (msg: AgentChatMessage) => Promise<void>;
  log?: {
    info: (msg: string, ...args: unknown[]) => void;
    warn: (msg: string, ...args: unknown[]) => void;
    error: (msg: string, ...args: unknown[]) => void;
    debug: (msg: string, ...args: unknown[]) => void;
  };
}

export class AgentChatGateway {
  private ws: WebSocket | null = null;
  private config: AgentChatConfig;
  private abortSignal: AbortSignal;
  private onMessage: (msg: AgentChatMessage) => Promise<void>;
  private log: GatewayContext["log"];
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isConnected = false;

  constructor(ctx: GatewayContext) {
    this.config = ctx.config;
    this.abortSignal = ctx.abortSignal;
    this.onMessage = ctx.onMessage;
    this.log = ctx.log || console;
  }

  async start(): Promise<void> {
    this.log?.info(`[AgentChat] 连接到 ${this.config.serverUrl}`);
    this.connect();
  }

  private connect(): void {
    if (this.abortSignal.aborted) {
      return;
    }

    try {
      this.ws = new WebSocket(this.config.serverUrl);

      this.ws.on("open", () => {
        this.log?.info("[AgentChat] WebSocket 连接已建立");
        this.sendJoin();
      });

      this.ws.on("message", (data) => {
        this.handleMessage(data);
      });

      this.ws.on("close", () => {
        this.log?.warn("[AgentChat] WebSocket 断开，3秒后重连...");
        this.isConnected = false;
        this.scheduleReconnect();
      });

      this.ws.on("error", (err) => {
        this.log?.error("[AgentChat] WebSocket 错误:", err.message);
      });
    } catch (err) {
      this.log?.error("[AgentChat] 连接失败:", err);
      this.scheduleReconnect();
    }
  }

  private sendJoin(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    this.ws.send(JSON.stringify({
      type: "agent_join",
      payload: {
        agent_id: this.config.agentId,
        token: this.config.token,
      },
    }));
  }

  private async handleMessage(data: WebSocket.RawData): Promise<void> {
    try {
      const msg = JSON.parse(data.toString());
      const { type, payload } = msg;

      switch (type) {
        case "agent_join_ack":
          this.isConnected = true;
          this.log?.info("[AgentChat] 已成功加入群聊");
          break;

        case "platform":
          this.log?.info("[AgentChat] 收到平台信息:", payload?.your_name);
          break;

        case "history":
          this.log?.info(`[AgentChat] 收到 ${payload?.messages?.length || 0} 条历史消息`);
          break;

        case "clear_history":
          this.log?.info("[AgentChat] 收到清空历史指令");
          break;

        case "ping":
          this.ws?.send(JSON.stringify({ type: "pong" }));
          break;

        case "message":
          await this.handleChatMessage(payload);
          break;

        case "error":
          this.log?.error("[AgentChat] 服务器错误:", payload?.message);
          break;

        default:
          this.log?.debug(`[AgentChat] 未知消息类型: ${type}`);
      }
    } catch (err) {
      this.log?.error("[AgentChat] 解析消息失败:", err);
    }
  }

  private async handleChatMessage(msg: AgentChatMessage): Promise<void> {
    // 忽略自己的消息
    if (msg.sender_type === "agent" && msg.sender_id === this.config.agentId) {
      return;
    }

    this.log?.info(`[AgentChat] [${msg.sender_type}] ${msg.sender_name}: ${msg.content}`);

    try {
      await this.onMessage(msg);
    } catch (err) {
      this.log?.error("[AgentChat] 处理消息失败:", err);
    }
  }

  sendMessage(content: string): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.isConnected) {
      this.log?.warn("[AgentChat] 未连接，无法发送消息");
      return false;
    }

    this.ws.send(JSON.stringify({
      type: "message",
      payload: { content },
    }));

    this.log?.info(`[AgentChat] 发送消息: ${content.substring(0, 50)}...`);
    return true;
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    this.reconnectTimer = setTimeout(() => {
      if (!this.abortSignal.aborted) {
        this.connect();
      }
    }, 3000);
  }

  stop(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.isConnected = false;
  }

  isReady(): boolean {
    return this.isConnected && this.ws?.readyState === WebSocket.OPEN;
  }
}

// 存储活跃的 gateway 实例
const gateways = new Map<string, AgentChatGateway>();

export function getGateway(accountId: string): AgentChatGateway | undefined {
  return gateways.get(accountId);
}

export function setGateway(accountId: string, gateway: AgentChatGateway): void {
  gateways.set(accountId, gateway);
}

export function removeGateway(accountId: string): void {
  const gateway = gateways.get(accountId);
  if (gateway) {
    gateway.stop();
    gateways.delete(accountId);
  }
}
