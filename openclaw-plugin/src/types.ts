/**
 * Agent Chat Plugin 类型定义
 */

export interface AgentChatConfig {
  /** Agent Chat 服务器地址 */
  serverUrl: string;
  /** Agent ID */
  agentId: string;
  /** 认证 Token */
  token: string;
  /** 是否启用 */
  enabled?: boolean;
}

export interface AgentChatAccount {
  accountId: string;
  enabled: boolean;
  configured: boolean;
  name: string;
  agentId: string;
  config?: AgentChatConfig;
}

export interface AgentChatMessage {
  id: string | number;
  sender_id: string;
  sender_name: string;
  sender_type: 'human' | 'agent' | 'system';
  content: string;
  created_at: string;
  _platform?: string;
}

export interface AgentChatRuntimeState {
  connected: boolean;
  lastMessageTime?: number;
  error?: string;
}
