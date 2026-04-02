/**
 * 技能定义与调用模块
 * 管理平台技能的定义、验证和执行
 */

const db = require('./database');

// 配置
const CONFIG = {
  skill_call_timeout_ms: 5000,
  max_input_size: 10000
};

/**
 * 内置技能实现
 * 这些是平台自带的技能，直接在服务端执行
 */
const builtinSkills = {
  /**
   * 搜索技能
   * 在消息历史中搜索关键词
   */
  search: async (input, context) => {
    const { query, limit = 10 } = input;
    if (!query) throw new Error('query 参数必填');

    // 从最近消息中搜索
    const messages = db.getRecentMessages(100);
    const results = messages
      .filter(m => m.content && m.content.toLowerCase().includes(query.toLowerCase()))
      .slice(0, limit)
      .map(m => ({
        id: m.id,
        sender_name: m.sender_name,
        content: m.content.substring(0, 200),
        created_at: m.created_at
      }));

    return { results, total: results.length };
  },

  /**
   * 总结技能
   * 生成内容的简短摘要
   */
  summarize: async (input, context) => {
    const { content, format = 'bullet' } = input;
    if (!content) throw new Error('content 参数必填');

    // 简单的摘要实现：截取前500字符
    const summary = content.length > 500
      ? content.substring(0, 500) + '...'
      : content;

    return { summary, format };
  },

  /**
   * 翻译技能占位
   * 实际翻译需要外部 API
   */
  translate: async (input, context) => {
    const { content, target_lang } = input;
    if (!content) throw new Error('content 参数必填');

    // 占位实现，返回提示
    return {
      translation: `[翻译到 ${target_lang || '目标语言'}]: ${content.substring(0, 100)}...`,
      note: '此为占位实现，需要接入实际翻译服务'
    };
  }
};

/**
 * 验证输入参数
 * @param {Object} input - 输入参数
 * @param {Object} schema - JSON Schema 定义
 * @returns {Object} 验证结果 { valid, errors }
 */
function validateInput(input, schema) {
  const errors = [];

  if (!schema || !schema.properties) {
    return { valid: true, errors: [] };
  }

  // 检查必填字段
  if (schema.required) {
    for (const field of schema.required) {
      if (input[field] === undefined || input[field] === null) {
        errors.push(`缺少必填字段: ${field}`);
      }
    }
  }

  // 检查字段类型
  for (const [field, def] of Object.entries(schema.properties)) {
    const value = input[field];
    if (value === undefined) continue;

    if (def.type === 'string' && typeof value !== 'string') {
      errors.push(`字段 ${field} 应为字符串`);
    } else if (def.type === 'number' && typeof value !== 'number') {
      errors.push(`字段 ${field} 应为数字`);
    } else if (def.type === 'array' && !Array.isArray(value)) {
      errors.push(`字段 ${field} 应为数组`);
    } else if (def.type === 'object' && typeof value !== 'object') {
      errors.push(`字段 ${field} 应为对象`);
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * 执行技能调用
 * @param {Object} skillCall - 技能调用请求
 * @param {Object} callerAgent - 调用方 Agent 信息
 * @param {Object} context - 执行上下文
 * @returns {Object} 执行结果
 */
async function executeSkill(skillCall, callerAgent, context = {}) {
  const { skill_id, input } = skillCall.payload || skillCall;
  const startTime = Date.now();

  try {
    // 1. 验证技能存在且启用
    const skill = db.getSkillById(skill_id);
    if (!skill) {
      return { status: 'failed', error: 'SKILL_NOT_FOUND', message: `技能 ${skill_id} 不存在` };
    }
    if (!skill.enabled) {
      return { status: 'failed', error: 'SKILL_DISABLED', message: `技能 ${skill_id} 已禁用` };
    }

    // 2. 验证 Agent 有该能力（可选检查）
    if (callerAgent && callerAgent.id) {
      const declaration = db.getAgentSkillDeclaration(callerAgent.id);
      if (declaration && declaration.declared_skills) {
        if (!declaration.declared_skills.includes(skill_id)) {
          // 不强制要求声明，只记录日志
          console.log(`[Skills] Agent ${callerAgent.id} 未声明技能 ${skill_id}，但允许执行`);
        }
      }
    }

    // 3. 验证输入参数
    const validation = validateInput(input || {}, skill.input_schema);
    if (!validation.valid) {
      return { status: 'failed', error: 'INVALID_INPUT', errors: validation.errors };
    }

    // 4. 执行技能
    let output;
    if (builtinSkills[skill_id]) {
      // 内置技能
      output = await builtinSkills[skill_id](input || {}, context);
    } else {
      // 外部技能（暂不支持）
      return { status: 'failed', error: 'SKILL_NOT_IMPLEMENTED', message: `技能 ${skill_id} 尚未实现` };
    }

    const duration_ms = Date.now() - startTime;

    // 5. 记录调用日志
    try {
      db.logSkillCall({
        skill_id,
        caller_id: callerAgent?.id || 'unknown',
        input_params: input,
        output_result: output,
        status: 'success',
        duration_ms
      });
    } catch (logErr) {
      console.error('[Skills] 记录日志失败:', logErr.message);
    }

    return {
      status: 'success',
      output,
      duration_ms
    };

  } catch (err) {
    console.error('[Skills] 执行异常:', err.message);
    const duration_ms = Date.now() - startTime;

    // 记录失败日志
    db.logSkillCall({
      skill_id,
      caller_id: callerAgent?.id || 'unknown',
      input_params: input,
      status: 'failed',
      duration_ms,
      error_message: err.message
    });

    return {
      status: 'failed',
      error: 'EXECUTION_ERROR',
      message: err.message
    };
  }
}

/**
 * 获取所有可用技能
 * @param {boolean} enabledOnly - 是否只返回启用的
 * @returns {Array} 技能列表
 */
function getAvailableSkills(enabledOnly = true) {
  const skills = enabledOnly ? db.getActiveSkills() : db.getAllSkills();
  return skills.map(skill => ({
    id: skill.id,
    name: skill.name,
    category: skill.category,
    description: skill.description,
    usage_hint: skill.usage_hint
  }));
}

/**
 * 获取技能详情
 * @param {string} skillId - 技能ID
 * @returns {Object|null} 技能详情
 */
function getSkillDetail(skillId) {
  const skill = db.getSkillById(skillId);
  if (!skill) return null;

  return {
    id: skill.id,
    name: skill.name,
    category: skill.category,
    description: skill.description,
    input_schema: skill.input_schema,
    output_schema: skill.output_schema,
    usage_hint: skill.usage_hint,
    is_builtin: !!builtinSkills[skill.id]
  };
}

/**
 * 注册新技能
 * @param {Object} skill - 技能定义
 * @returns {Object} 创建的技能
 */
function registerSkill(skill) {
  // 验证必填字段
  if (!skill.id || !skill.name) {
    throw new Error('技能 id 和 name 必填');
  }

  // 检查是否已存在
  const existing = db.getSkillById(skill.id);
  if (existing) {
    throw new Error(`技能 ${skill.id} 已存在`);
  }

  return db.createSkill(skill);
}

/**
 * 更新技能
 * @param {string} skillId - 技能ID
 * @param {Object} updates - 更新内容
 * @returns {Object} 更新后的技能
 */
function updateSkill(skillId, updates) {
  const existing = db.getSkillById(skillId);
  if (!existing) {
    throw new Error(`技能 ${skillId} 不存在`);
  }

  return db.updateSkill(skillId, updates);
}

/**
 * 注销技能
 * @param {string} skillId - 技能ID
 */
function unregisterSkill(skillId) {
  const existing = db.getSkillById(skillId);
  if (!existing) {
    throw new Error(`技能 ${skillId} 不存在`);
  }

  db.deleteSkill(skillId);
}

module.exports = {
  executeSkill,
  getAvailableSkills,
  getSkillDetail,
  registerSkill,
  updateSkill,
  unregisterSkill,
  validateInput,
  builtinSkills,
  CONFIG
};