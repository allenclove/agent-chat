/**
 * 规则匹配与执行引擎
 * 负责平台规则的匹配、冲突仲裁和动作执行
 */

const db = require('./database');

// 配置
const CONFIG = {
  max_rules_per_message: 5,
  evaluation_timeout_ms: 50
};

/**
 * 解析触发条件
 * 支持简单条件、比较操作、逻辑组合
 * @param {Object} trigger - 触发条件
 * @param {Object} context - 运行时上下文
 * @returns {boolean} 是否匹配
 */
function evaluateTrigger(trigger, context) {
  if (!trigger || typeof trigger !== 'object') return false;

  for (const [key, value] of Object.entries(trigger)) {
    // 逻辑组合
    if (key === 'and') {
      if (!Array.isArray(value)) return false;
      if (!value.every(t => evaluateTrigger(t, context))) return false;
    } else if (key === 'or') {
      if (!Array.isArray(value)) return false;
      if (!value.some(t => evaluateTrigger(t, context))) return false;
    } else if (key === 'not') {
      if (evaluateTrigger(value, context)) return false;
    } else if (typeof value === 'object' && value !== null) {
      // 比较操作
      const actual = getNestedValue(context, key);
      if (value.gt !== undefined && !(actual > value.gt)) return false;
      if (value.gte !== undefined && !(actual >= value.gte)) return false;
      if (value.lt !== undefined && !(actual < value.lt)) return false;
      if (value.lte !== undefined && !(actual <= value.lte)) return false;
      if (value.eq !== undefined && !(actual === value.eq)) return false;
      if (value.ne !== undefined && !(actual !== value.ne)) return false;
      if (value.exists !== undefined) {
        const exists = actual !== undefined && actual !== null;
        if (value.exists && !exists) return false;
        if (!value.exists && exists) return false;
      }
      if (value.contains !== undefined) {
        if (!Array.isArray(actual) || !actual.includes(value.contains)) return false;
      }
    } else {
      // 简单相等
      const actual = getNestedValue(context, key);
      if (actual !== value) return false;
    }
  }
  return true;
}

/**
 * 获取嵌套属性值
 * 支持 'locks.fact_check' 这样的路径
 */
function getNestedValue(obj, path) {
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = current[part];
  }
  return current;
}

/**
 * 检测规则冲突
 * @param {Array} rules - 已排序的规则列表
 * @returns {Array} 解决冲突后的规则列表
 */
function resolveConflicts(rules) {
  if (rules.length <= 1) return rules;

  // 检测相同优先级的规则
  const priorityGroups = {};
  for (const rule of rules) {
    const p = rule.priority || 100;
    if (!priorityGroups[p]) priorityGroups[p] = [];
    priorityGroups[p].push(rule);
  }

  // 每个优先级组内，按 ID 排序确保确定性
  const result = [];
  const priorities = Object.keys(priorityGroups).map(Number).sort((a, b) => b - a);

  for (const p of priorities) {
    const group = priorityGroups[p];
    group.sort((a, b) => a.id.localeCompare(b.id));
    result.push(...group);
  }

  // 限制最大规则数
  return result.slice(0, CONFIG.max_rules_per_message);
}

/**
 * 执行规则动作
 * @param {Object} action - 动作定义
 * @param {Object} state - 当前状态
 * @returns {Object} 状态变更
 */
function executeAction(action, state) {
  const changes = {};

  if (action.set) {
    Object.assign(changes, action.set);
  }

  if (action.add_action) {
    if (!state.recommended_actions) state.recommended_actions = [];
    changes.recommended_actions = [...state.recommended_actions, action.add_action];
  }

  if (action.remove_action) {
    if (!state.recommended_actions) state.recommended_actions = [];
    changes.recommended_actions = state.recommended_actions.filter(a => a !== action.remove_action);
  }

  if (action.block_forward) {
    changes._blockForward = true;
  }

  return changes;
}

/**
 * 处理消息的规则匹配和执行
 * @param {Object} message - 消息对象
 * @param {Object} runtimeContext - 运行时上下文
 * @returns {Object} 状态变更和审计日志
 */
function processRules(message, runtimeContext) {
  const startTime = Date.now();
  const result = {
    stateChanges: {},
    matchedRules: [],
    auditLogs: []
  };

  try {
    // 获取启用的规则
    const rules = db.getActiveRules();

    // 匹配规则
    for (const rule of rules) {
      try {
        if (evaluateTrigger(rule.trigger, runtimeContext)) {
          result.matchedRules.push(rule);
        }
      } catch (err) {
        console.error(`[Rules] 规则 ${rule.id} 解析失败:`, err.message);
        db.logRuleAudit({
          rule_id: rule.id,
          result: 'error',
          action_taken: { error: err.message }
        });
      }
    }

    // 冲突仲裁
    const resolved = resolveConflicts(result.matchedRules);

    // 执行动作
    for (const rule of resolved) {
      if (rule.must) {
        const changes = executeAction(rule.must, result.stateChanges);
        Object.assign(result.stateChanges, changes);
      }

      // 记录审计日志
      db.logRuleAudit({
        rule_id: rule.id,
        message_id: message.id,
        agent_id: message.sender_id,
        trigger_context: runtimeContext,
        action_taken: rule.must,
        result: 'executed'
      });

      result.auditLogs.push({
        rule_id: rule.id,
        executed: true
      });
    }

    result.duration_ms = Date.now() - startTime;
    return result;

  } catch (err) {
    console.error('[Rules] 规则处理失败:', err.message);
    result.error = err.message;
    return result;
  }
}

/**
 * 获取规则的运行时状态
 * @param {string} agentId - Agent ID
 * @returns {Object} 运行时状态
 */
function getAgentRuntimeState(agentId) {
  // 这里会被 context.js 调用
  return {
    agent_id: agentId,
    locks: {},
    cooldowns: {},
    pack_state: {}
  };
}

/**
 * 初始化默认规则
 */
function initDefaultRules() {
  db.initDefaultGovernanceData();
}

module.exports = {
  evaluateTrigger,
  resolveConflicts,
  executeAction,
  processRules,
  getAgentRuntimeState,
  initDefaultRules,
  CONFIG
};