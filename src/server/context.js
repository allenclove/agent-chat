/**
 * 上下文组装模块
 * 负责组装和下发平台上下文
 */

const db = require('./database');
const scenes = require('./scenes');
const protocol = require('./protocol');

// 配置
const CONFIG = {
  assembly_timeout_ms: 20
};

/**
 * Layer 1: Platform Info (连接时下发)
 * @param {Object} agentConfig - Agent 配置
 * @returns {Object} 平台信息
 */
function getPlatformInfo(agentConfig) {
  return {
    platform_id: 'agent-chat-v2',
    platform_name: 'Agent Chat',
    protocol_version: '2.1.0',
    your_id: agentConfig.id,
    your_name: agentConfig.name,
    capabilities: protocol.getPlatformCapabilities(),
    rules_version: getRulesVersion()
  };
}

/**
 * Layer 2: Platform Context (场景级)
 * @param {string} agentId - Agent ID
 * @returns {Object} 平台上下文
 */
function getPlatformContext(agentId) {
  // 获取 Agent 当前所在的场景
  const activeScene = scenes.getActiveScene();

  const availableScenes = scenes.getAvailableScenes();

  return {
    scene: activeScene ? activeScene.id : null,
    scene_config: activeScene ? {
      scene_id: activeScene.id,
      scene_name: activeScene.name,
      scene_mode: activeScene.context_prompt
    } : null,
    available_scenes: availableScenes.map(s => s.id),
    is_active: !!activeScene
  };
}

/**
 * Layer 3: Runtime State (消息级)
 * @param {Object} message - 消息对象
 * @param {string} agentId - 目标 Agent ID
 * @returns {Object} 运行时状态
 */
function getRuntimeState(message, agentId) {
  const state = {
    reply_required: false,
    mentioned: false,
    mentioned_by: null,
    current_scene: null,
    turn_info: null,
    locks: db.getAgentLocks(agentId),
    cooldowns: db.getAgentCooldowns(agentId),
    pack_state: {},
    recommended_actions: []
  };

  // 检查是否被点名
  if (message && message.mentions && Array.isArray(message.mentions)) {
    if (message.mentions.includes(agentId)) {
      state.mentioned = true;
      state.mentioned_by = message.sender_id;
      state.reply_required = true;
    }
  }

  // 检查内容中是否被 @
  if (message && message.content) {
    const mentionPattern = new RegExp(`@${agentId}\\b`, 'i');
    if (mentionPattern.test(message.content)) {
      state.mentioned = true;
      state.mentioned_by = message.sender_id;
      state.reply_required = true;
    }
  }

  // 获取场景状态
  const activeScene = scenes.getActiveScene();
  if (activeScene) {
    state.current_scene = activeScene.id;
    state.scene_name = activeScene.name;
    state.scene_mode = activeScene.context_prompt;
  }

  return state;
}

/**
 * 获取规则版本
 * @returns {string} 规则版本号
 */
function getRulesVersion() {
  const rules = db.getAllRules();
  if (rules.length === 0) return '1.0';

  // 使用最新更新时间作为版本
  let latestUpdate = 0;
  for (const rule of rules) {
    const updatedAt = new Date(rule.updated_at || rule.created_at).getTime();
    if (updatedAt > latestUpdate) {
      latestUpdate = updatedAt;
    }
  }

  // 格式化为版本号
  const date = new Date(latestUpdate);
  return `${date.getFullYear()}.${date.getMonth() + 1}.${date.getDate()}`;
}

/**
 * 为消息注入上下文
 * @param {Object} message - 原始消息
 * @param {string} targetAgentId - 目标 Agent ID
 * @param {Object} options - 选项
 * @returns {Object} 带上下文的消息
 */
function injectContext(message, targetAgentId, options = {}) {
  const startTime = Date.now();

  try {
    // 获取运行时状态
    const runtimeState = getRuntimeState(message, targetAgentId);

    // 合并规则执行结果的状态变更
    if (options.stateChanges) {
      Object.assign(runtimeState, options.stateChanges);
    }

    // 构建带上下文的消息
    const enrichedMessage = {
      ...message,
      _context: {
        platform_context: options.platformContext || null,
        runtime_state: runtimeState
      }
    };

    return enrichedMessage;

  } catch (err) {
    console.error('[Context] 上下文组装失败:', err.message);
    // 返回原始消息
    return message;
  }
}

/**
 * 获取 Agent 的完整上下文
 * @param {string} agentId - Agent ID
 * @returns {Object} 完整上下文
 */
function getFullContext(agentId) {
  const agent = db.getAgentById(agentId);
  if (!agent) {
    throw new Error(`Agent ${agentId} 不存在`);
  }

  return {
    platform_info: getPlatformInfo(agent),
    platform_context: getPlatformContext(agentId),
    runtime_state: getRuntimeState(null, agentId)
  };
}

/**
 * 组装场景激活通知
 * @param {Object} sceneInfo - 场景信息
 * @param {string} agentId - Agent ID
 * @returns {Object} 激活通知消息
 */
function assembleSceneActivation(sceneInfo, agentId) {
  return {
    type: 'scene_activate',
    payload: {
      scene_id: sceneInfo.id,
      scene_name: sceneInfo.name,
      scene_mode: sceneInfo.context_prompt,
      participants: sceneInfo.participants || [],
      platform_context: getPlatformContext(agentId)
    }
  };
}

/**
 * 组装规则更新通知
 * @param {string} newVersion - 新版本号
 * @returns {Object} 更新通知消息
 */
function assembleRulesUpdate(newVersion) {
  return {
    type: 'rules_update',
    payload: {
      rules_version: newVersion,
      timestamp: new Date().toISOString()
    }
  };
}

/**
 * 获取可用技能列表（给 Agent）
 * @param {string} agentId - Agent ID
 * @returns {Array} 可用技能列表
 */
function getAvailableSkillsForAgent(agentId) {
  // 获取 Agent 声明的技能
  const declaration = db.getAgentSkillDeclaration(agentId);
  const declaredSkills = declaration?.declared_skills || [];

  // 获取所有启用的技能
  const allSkills = db.getActiveSkills();

  // 标记哪些是 Agent 已声明的
  return allSkills.map(skill => ({
    id: skill.id,
    name: skill.name,
    category: skill.category,
    description: skill.description,
    declared: declaredSkills.includes(skill.id)
  }));
}

module.exports = {
  getPlatformInfo,
  getPlatformContext,
  getRuntimeState,
  getRulesVersion,
  injectContext,
  getFullContext,
  assembleSceneActivation,
  assembleRulesUpdate,
  getAvailableSkillsForAgent,
  CONFIG
};