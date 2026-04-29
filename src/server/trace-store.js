/**
 * Trace Store - 消息追踪事件存储
 *
 * 存储消息的完整生命周期事件，用于可观测性调试
 */

const { v4: uuidv4 } = require('uuid');

const MAX_TRACES = 1000;
const traces = new Map();
const messageToTrace = new Map();

// 录制开关：调试窗口打开时为 true，关闭时为 false
let recording = false;

const traceStore = {
  setRecording(on) {
    recording = !!on;
    if (!on) {
      traces.clear();
      messageToTrace.clear();
    }
    console.log(`[Trace] 录制${on ? '开启' : '关闭'}${on ? '' : '，已清空缓冲区'}`);
  },

  isRecording() {
    return recording;
  },

  createTrace(messageId, metadata) {
    if (!recording) return null;

    const traceId = `trace_${uuidv4().split('-')[0]}`;
    traces.set(traceId, {
      message_id: messageId,
      metadata,
      events: [],
      created_at: Date.now()
    });
    messageToTrace.set(String(messageId), traceId);

    if (traces.size > MAX_TRACES) {
      const oldestKeys = [...traces.keys()].slice(0, traces.size - MAX_TRACES);
      for (const key of oldestKeys) {
        const t = traces.get(key);
        if (t?.message_id) messageToTrace.delete(String(t.message_id));
        traces.delete(key);
      }
    }
    return traceId;
  },

  addEvent(traceId, eventType, details = {}) {
    if (!recording || !traceId) return;
    const trace = traces.get(traceId);
    if (!trace) return;
    trace.events.push({ type: eventType, timestamp: Date.now(), details });
  },

  // 辅助：记录规则匹配事件
  addRuleEvent(traceId, matchedRules, stateChanges) {
    if (!recording || !traceId) return;
    this.addEvent(traceId, 'rules_evaluated', {
      matched_rules: matchedRules,
      state_changes: stateChanges
    });
  },

  // 辅助：记录上下文注入事件
  addContextEvent(traceId, agentId, runtimeState) {
    if (!recording || !traceId) return;
    this.addEvent(traceId, 'context_injected', {
      agent_id: agentId,
      mentioned: runtimeState.mentioned,
      reply_required: runtimeState.reply_required,
      locks: runtimeState.locks,
      cooldowns: runtimeState.cooldowns,
      current_scene: runtimeState.current_scene
    });
  },

  getTraceIdByMessageId(messageId) {
    return messageToTrace.get(String(messageId));
  },

  getTrace(traceId) {
    return traces.get(traceId);
  },

  getTraceByMessageId(messageId) {
    const traceId = this.getTraceIdByMessageId(messageId);
    if (!traceId) return null;
    return this.getTrace(traceId);
  },

  getRecentTraces(limit = 50) {
    return [...traces.values()].reverse().slice(0, limit).map(t => ({
      trace_id: this.getTraceIdByMessageId(t.message_id),
      message_id: t.message_id,
      metadata: t.metadata,
      event_count: t.events.length,
      created_at: t.created_at,
      last_event: t.events[t.events.length - 1]?.type || 'created'
    }));
  },

  getTraceEvents(traceId) {
    const trace = traces.get(traceId);
    if (!trace) return null;
    return trace.events;
  },

  getStats() {
    return {
      total_traces: traces.size,
      max_capacity: MAX_TRACES,
      recording
    };
  },

  clear() {
    traces.clear();
    messageToTrace.clear();
  }
};

// 事件类型常量
const EVENT_TYPES = {
  // 消息生成阶段
  MESSAGE_CREATED: 'message_created',       // 消息在数据库创建
  CONTENT_GENERATED: 'content_generated',   // Agent 生成内容完成

  // 发送阶段
  SEND_ATTEMPTED: 'send_attempted',          // 尝试发送到服务端
  SEND_SUCCESS: 'send_success',              // 发送成功

  // 服务端处理阶段
  SERVER_RECEIVED: 'server_received',        // 服务端收到消息
  SERVER_BROADCAST: 'server_broadcast',      // 服务端开始广播
  SERVER_FORWARD_AGENT: 'server_forward_agent', // 转发给Agent

  // 前端渲染阶段
  FRONTEND_RENDERED: 'frontend_rendered',    // 前端渲染完成
  CLIENT_RECEIVED: 'client_received',        // 客户端收到消息

  // Agent处理阶段
  AGENT_RECEIVED: 'agent_received',          // Agent收到消息
  AGENT_PROCESSING: 'agent_processing',      // Agent开始处理
  AGENT_RESPONSE_READY: 'agent_response_ready', // Agent响应准备好

  // 错误状态
  ERROR: 'error',                            // 发生错误
  TIMEOUT: 'timeout',                        // 超时
  RETRY: 'retry'                             // 重试
};

module.exports = { traceStore, EVENT_TYPES };