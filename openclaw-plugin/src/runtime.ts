/**
 * Agent Chat Runtime
 */

import type { PluginRuntime } from "openclaw/plugin-sdk";

let runtime: PluginRuntime | null = null;

export function setAgentChatRuntime(r: PluginRuntime): void {
  runtime = r;
}

export function getAgentChatRuntime(): PluginRuntime {
  if (!runtime) {
    throw new Error("AgentChat runtime not initialized");
  }
  return runtime;
}
