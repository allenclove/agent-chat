/**
 * OpenClaw Agent Chat Plugin
 *
 * 连接 OpenClaw 到 Agent Chat 群聊系统
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { agentChatPlugin } from "./src/channel.js";
import { setAgentChatRuntime } from "./src/runtime.js";

const plugin = {
  id: "agent-chat",
  name: "Agent Chat",
  description: "Agent Chat 群聊频道插件",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setAgentChatRuntime(api.runtime);
    api.registerChannel({ plugin: agentChatPlugin });
  },
};

export default plugin;

export { agentChatPlugin } from "./src/channel.js";
export { setAgentChatRuntime, getAgentChatRuntime } from "./src/runtime.js";
export * from "./src/types.js";
export * from "./src/gateway.js";
