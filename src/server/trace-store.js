/**
 * Trace Store - 消息追踪事件存储
 *
 * 存储消息的完整生命周期事件，用于可观测性调试
 */

const { v4: uuidv4 } = require('uuid');

// 最大存储事件数（避免内存溢出）
const MAX_TRACES = 1000;

// 存储结构：
// Map<trace_id, { message_id, events: [], metadata }>
const traces = new Map();

// 消息ID到trace_id的映射
const messageToTrace = new Map();

const traceStore = {
  /**
   * 创建新的追踪记录
   * @param {string} messageId - 消息ID
   * @param {object} metadata - 消息元数据 (sender_id, sender_name, sender_type)
   * @returns {string} trace_id
   */
  createTrace(messageId, metadata) {
    const traceId = `trace_${uuidv4().split('-')[0]}`;

    traces.set(traceId, {
      message_id: messageId,
      metadata,
      events: [],
      created_at: Date.now()
    });

    messageToTrace.set(String(messageId), traceId);

    // 清理旧的追踪记录
    if (traces.size > MAX_TRACES) {
      const oldestKeys = [...traces.keys()].slice(0, traces.size - MAX_TRACES);
      for (const key of oldestKeys) {
        const trace = traces.get(key);
        if (trace?.message_id) {
          messageToTrace.delete(String(trace.message_id));
        }
        traces.delete(key);
      }
    }

    return traceId;
  },

  /**
   * 添加追踪事件
   * @param {string} traceId - 追踪ID
   * @param {string} eventType - 事件类型
   * @param {object} details - 事件详情
   */
  addEvent(traceId, eventType, details = {}) {
    const trace = traces.get(traceId);
    if (!trace) {
      console.warn(`[Trace] 未找到追踪记录: ${traceId}`);
      return;
    }

    trace.events.push({
      type: eventType,
      timestamp: Date.now(),
      details
    });
  },

  /**
   * 通过消息ID获取trace_id
   * @param {string|number} messageId
   * @returns {string|null}
   */
  getTraceIdByMessageId(messageId) {
    return messageToTrace.get(String(messageId));
  },

  /**
   * 获取完整的追踪记录
   * @param {string} traceId
   * @returns {object|null}
   */
  getTrace(traceId) {
    return traces.get(traceId);
  },

  /**
   * 通过消息ID获取追踪记录
   * @param {string|number} messageId
   * @returns {object|null}
   */
  getTraceByMessageId(messageId) {
    const traceId = this.getTraceIdByMessageId(messageId);
    if (!traceId) return null;
    return this.getTrace(traceId);
  },

  /**
   * 获取最近的追踪记录列表
   * @param {number} limit - 返回数量
   * @returns {Array}
   */
  getRecentTraces(limit = 50) {
    const allTraces = [...traces.values()].reverse().slice(0, limit);
    return allTraces.map(t => ({
      trace_id: this.getTraceIdByMessageId(t.message_id),
      message_id: t.message_id,
      metadata: t.metadata,
      event_count: t.events.length,
      created_at: t.created_at,
      last_event: t.events[t.events.length - 1]?.type || 'created'
    }));
  },

  /**
   * 获取追踪事件详情
   * @param {string} traceId
   * @returns {Array|null}
   */
  getTraceEvents(traceId) {
    const trace = traces.get(traceId);
    if (!trace) return null;
    return trace.events;
  },

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      total_traces: traces.size,
      max_capacity: MAX_TRACES
    };
  },

  /**
   * 清空所有追踪记录
   */
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