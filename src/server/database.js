const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { traceStore, EVENT_TYPES } = require('./trace-store');

const dbPath = path.join(__dirname, '../../data/chat.db');
let db = null;

// ==================== 辅助函数 ====================

/**
 * 解析 sql.js 返回的单行结果
 * @param {Array} result - sql.js exec 返回的结果
 * @returns {Object|null} 解析后的对象或 null
 */
function parseSingleResult(result) {
  if (!result || result.length === 0 || result[0].values.length === 0) return null;
  const row = {};
  result[0].columns.forEach((col, i) => row[col] = result[0].values[0][i]);
  return row;
}

/**
 * 解析 sql.js 返回的多行结果
 * @param {Array} result - sql.js exec 返回的结果
 * @returns {Array<Object>} 解析后的对象数组
 */
function parseMultipleResults(result) {
  if (!result || result.length === 0) return [];
  return result[0].values.map(values => {
    const row = {};
    result[0].columns.forEach((col, i) => row[col] = values[i]);
    return row;
  });
}

/**
 * 安全解析 JSON 字段
 * @param {string} value - JSON 字符串
 * @param {*} defaultValue - 解析失败时的默认值
 * @returns {*} 解析后的值或默认值
 */
function safeParseJson(value, defaultValue = null) {
  if (!value) return defaultValue;
  try {
    return JSON.parse(value);
  } catch (e) {
    return defaultValue;
  }
}

/**
 * 解析结果中的指定 JSON 字段
 * @param {Object} obj - 要处理的对象
 * @param {Array<string>} jsonFields - 需要解析的 JSON 字段名列表
 * @returns {Object} 处理后的对象
 */
function parseJsonFields(obj, jsonFields) {
  if (!obj) return obj;
  for (const field of jsonFields) {
    if (obj[field] && typeof obj[field] === 'string') {
      obj[field] = safeParseJson(obj[field], obj[field]);
    }
  }
  return obj;
}

// ==================== 数据库初始化 ====================
async function init() {
  const SQL = await initSqlJs();

  // 尝试加载现有数据库
  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  // 创建表
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      avatar_url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_id TEXT NOT NULL,
      sender_name TEXT NOT NULL,
      sender_type TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS agent_configs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      avatar_url TEXT,
      token TEXT NOT NULL,
      message_filter TEXT DEFAULT 'all',
      keywords TEXT,
      history_limit INTEGER DEFAULT 50,
      enabled INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 迁移：添加新的配置字段（如果不存在）
  try {
    db.run(`ALTER TABLE agent_configs ADD COLUMN persona TEXT`);
  } catch (e) { /* 列已存在，忽略 */ }
  try {
    db.run(`ALTER TABLE agent_configs ADD COLUMN conversation_mode TEXT DEFAULT 'free'`);
  } catch (e) { /* 列已存在，忽略 */ }
  try {
    db.run(`ALTER TABLE agent_configs ADD COLUMN custom_settings TEXT`);
  } catch (e) { /* 列已存在，忽略 */ }
  try {
    db.run(`ALTER TABLE agent_configs ADD COLUMN request_id TEXT`);
  } catch (e) { /* 列已存在，忽略 */ }
  try {
    db.run(`ALTER TABLE agent_configs ADD COLUMN runtime_type TEXT DEFAULT 'generic-ws'`);
  } catch (e) { /* 列已存在，忽略 */ }
  try {
    db.run(`ALTER TABLE agent_configs ADD COLUMN capabilities TEXT`);
  } catch (e) { /* 列已存在，忽略 */ }
  try {
    db.run(`ALTER TABLE agent_configs ADD COLUMN receive_mode TEXT DEFAULT 'free'`);
  } catch (e) { /* 列已存在，忽略 */ }

  // Agent 接入申请表（新协议）
  db.run(`
    CREATE TABLE IF NOT EXISTS join_requests (
      request_id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      proposed_name TEXT NOT NULL,
      runtime_type TEXT DEFAULT 'generic-ws',
      connector_version TEXT,
      bootstrap_token TEXT,
      capabilities TEXT,
      description TEXT,
      source_host TEXT,
      source_instance TEXT,
      metadata TEXT,
      display_name TEXT,
      target_room TEXT DEFAULT 'main',
      receive_mode TEXT DEFAULT 'free',
      capability_scope TEXT,
      notes TEXT,
      status TEXT DEFAULT 'pending',
      submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME,
      approved_by TEXT,
      approved_at DATETIME,
      rejected_reason TEXT,
      last_seen_at DATETIME,
      activation_session_id TEXT,
      connection_secret TEXT,
      activation_expires_at DATETIME
    )
  `);

  // 系统设置表
  db.run(`
    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      description TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 话题表
  db.run(`
    CREATE TABLE IF NOT EXISTS topics (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      created_by TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      status TEXT DEFAULT 'active'
    )
  `);

  // 话题消息表（消息副本，独立于 messages 表）
  db.run(`
    CREATE TABLE IF NOT EXISTS topic_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      topic_id TEXT NOT NULL,
      original_message_id TEXT,
      sender_id TEXT NOT NULL,
      sender_name TEXT NOT NULL,
      sender_type TEXT NOT NULL,
      content TEXT NOT NULL,
      original_created_at TEXT,
      sequence INTEGER NOT NULL,
      FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE
    )
  `);

  // 迁移：为已存在的表添加 original_message_id 列
  try {
    const columns = db.exec("PRAGMA table_info(topic_messages)");
    if (columns.length > 0) {
      const hasOriginalId = columns[0].values.some(col => col[1] === 'original_message_id');
      if (!hasOriginalId) {
        db.run('ALTER TABLE topic_messages ADD COLUMN original_message_id TEXT');
        console.log('[DB] 已添加 original_message_id 列到 topic_messages 表');
      }
    }
  } catch (e) {
    console.log('[DB] 迁移检查跳过:', e.message);
  }

  // 话题总结表
  db.run(`
    CREATE TABLE IF NOT EXISTS topic_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      topic_id TEXT NOT NULL,
      narrative TEXT,
      viewpoints TEXT,
      consensus TEXT,
      open_questions TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE
    )
  `);

  // ==================== 平台治理相关表 ====================

  // 平台规则表
  db.run(`
    CREATE TABLE IF NOT EXISTS platform_rules (
      id TEXT PRIMARY KEY,
      summary TEXT NOT NULL,
      trigger TEXT NOT NULL,
      must TEXT,
      must_not TEXT,
      priority INTEGER DEFAULT 100,
      version TEXT DEFAULT '1.0',
      enabled INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 平台技能表
  db.run(`
    CREATE TABLE IF NOT EXISTS platform_skills (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      category TEXT,
      input_schema TEXT,
      output_schema TEXT,
      usage_hint TEXT,
      version TEXT DEFAULT '1.0',
      enabled INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 能力包表
  db.run(`
    CREATE TABLE IF NOT EXISTS capability_packs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      goal TEXT,
      skills TEXT,
      state_fields TEXT,
      trigger_keywords TEXT,
      version TEXT DEFAULT '1.0',
      enabled INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Agent 技能声明表
  db.run(`
    CREATE TABLE IF NOT EXISTS agent_skill_declarations (
      agent_id TEXT PRIMARY KEY,
      declared_skills TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (agent_id) REFERENCES agent_configs(id) ON DELETE CASCADE
    )
  `);

  // 规则审计日志表
  db.run(`
    CREATE TABLE IF NOT EXISTS rule_audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rule_id TEXT NOT NULL,
      message_id INTEGER,
      agent_id TEXT,
      trigger_context TEXT,
      action_taken TEXT,
      result TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 技能调用日志表
  db.run(`
    CREATE TABLE IF NOT EXISTS skill_call_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      skill_id TEXT NOT NULL,
      caller_id TEXT NOT NULL,
      input_params TEXT,
      output_result TEXT,
      status TEXT,
      duration_ms INTEGER,
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 场景状态表
  db.run(`
    CREATE TABLE IF NOT EXISTS scene_states (
      scene_id TEXT PRIMARY KEY,
      pack_id TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      participants TEXT,
      state_data TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME
    )
  `);

  // 治理提案表
  db.run(`
    CREATE TABLE IF NOT EXISTS governance_proposals (
      id TEXT PRIMARY KEY,
      target_type TEXT NOT NULL,
      target_id TEXT,
      action TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      proposer TEXT NOT NULL,
      reviewed_by TEXT,
      reviewed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 变更历史表
  db.run(`
    CREATE TABLE IF NOT EXISTS governance_changelog (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      action TEXT NOT NULL,
      old_value TEXT,
      new_value TEXT,
      changed_by TEXT NOT NULL,
      changed_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 初始化默认设置
  initDefaultSettings();

  // 从配置文件加载Agent
  loadAgentsFromConfig();

  // 启动配置文件热更新监听
  startConfigWatcher();

  save();
  console.log('[DB] 数据库初始化完成');
}

// 保存数据库到文件
function save() {
  if (db) {
    const data = db.export();
    const buffer = Buffer.from(data);
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(dbPath, buffer);
  }
}

// 用户相关操作
function createUser(username, displayName, avatarUrl = null) {
  const id = uuidv4();
  db.run(
    'INSERT INTO users (id, username, display_name, avatar_url) VALUES (?, ?, ?, ?)',
    [id, username, displayName, avatarUrl]
  );
  save();
  return { id, username, display_name: displayName, avatar_url: avatarUrl };
}

function findUserByUsername(username) {
  const result = db.exec('SELECT * FROM users WHERE username = ?', [username]);
  return parseSingleResult(result);
}

function findUserById(id) {
  const result = db.exec('SELECT * FROM users WHERE id = ?', [id]);
  return parseSingleResult(result);
}

// 会话相关操作
function createSession(userId) {
  const sessionId = uuidv4();
  db.run(
    "INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, datetime('now', '+7 days'))",
    [sessionId, userId]
  );
  save();
  return sessionId;
}

function findSessionById(sessionId) {
  const result = db.exec(`
    SELECT s.id, s.user_id, s.created_at, s.expires_at,
           u.username, u.display_name, u.avatar_url
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.id = ? AND s.expires_at > datetime('now')
  `, [sessionId]);

  return parseSingleResult(result);
}

function deleteSession(sessionId) {
  db.run('DELETE FROM sessions WHERE id = ?', [sessionId]);
  save();
}

function cleanExpiredSessions() {
  db.run("DELETE FROM sessions WHERE expires_at < datetime('now')");
  save();
}

// 消息相关操作
function createMessage(senderId, senderName, senderType, content) {
  const createdAt = formatShanghaiTime(new Date());

  db.run(
    'INSERT INTO messages (sender_id, sender_name, sender_type, content, created_at) VALUES (?, ?, ?, ?, ?)',
    [senderId, senderName, senderType, content, createdAt]
  );

  const result = db.exec('SELECT last_insert_rowid()');
  const id = result[0].values[0][0];

  save();

  // 创建追踪记录
  const traceId = traceStore.createTrace(id, {
    sender_id: senderId,
    sender_name: senderName,
    sender_type: senderType
  });

  // 记录消息创建事件
  traceStore.addEvent(traceId, EVENT_TYPES.MESSAGE_CREATED, {
    content_length: content.length,
    content_preview: content.substring(0, 100)
  });

  return {
    id,
    trace_id: traceId,
    sender_id: senderId,
    sender_name: senderName,
    sender_type: senderType,
    content,
    created_at: createdAt
  };
}

// 格式化为上海时间: 2026-03-23 12:00:00
function formatShanghaiTime(date) {
  return date.toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).replace(/\//g, '-');
}

function getRecentMessages(limit = 50) {
  const result = db.exec(
    'SELECT * FROM messages ORDER BY created_at DESC LIMIT ?',
    [limit]
  );

  if (result.length === 0) return [];

  // 反转顺序，使最新消息在底部
  const messages = parseMultipleResults(result);
  return messages.reverse();
}

// 清空所有消息
function clearMessages() {
  db.run('DELETE FROM messages');
  save();
  console.log('[DB] 所有消息已清空');
  return true;
}

// 获取消息统计
function getMessageStats() {
  const totalResult = db.exec('SELECT COUNT(*) FROM messages');
  const total = totalResult.length > 0 ? totalResult[0].values[0][0] : 0;

  const byTypeResult = db.exec('SELECT sender_type, COUNT(*) FROM messages GROUP BY sender_type');
  const byType = {};
  if (byTypeResult.length > 0) {
    byTypeResult[0].values.forEach(row => {
      byType[row[0]] = row[1];
    });
  }

  return { total, byType };
}

// Agent配置相关操作
function getAllAgents() {
  const result = db.exec('SELECT * FROM agent_configs WHERE enabled = 1');
  return parseMultipleResults(result);
}

function getAgentById(id) {
  const result = db.exec('SELECT * FROM agent_configs WHERE id = ?', [id]);
  return parseSingleResult(result);
}

// 添加Agent配置
function addAgent(config) {
  // 检查是否已存在
  const existing = getAgentById(config.id);
  if (existing) {
    // 更新配置
    db.run(
      `UPDATE agent_configs SET name = ?, avatar_url = ?, token = ?, message_filter = ?, keywords = ?, history_limit = ?, enabled = 1 WHERE id = ?`,
      [
        config.name,
        config.avatar_url || null,
        config.token,
        config.message_filter || 'all',
        config.keywords ? JSON.stringify(config.keywords) : null,
        config.history_limit || 50,
        config.id
      ]
    );
  } else {
    // 插入新配置
    db.run(
      `INSERT INTO agent_configs (id, name, avatar_url, token, message_filter, keywords, history_limit, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        config.id,
        config.name,
        config.avatar_url || null,
        config.token,
        config.message_filter || 'all',
        config.keywords ? JSON.stringify(config.keywords) : null,
        config.history_limit || 50
      ]
    );
  }
  save();
}

// 通过token验证Agent
function getAgentByToken(token) {
  const result = db.exec('SELECT * FROM agent_configs WHERE token = ? AND enabled = 1', [token]);
  return parseSingleResult(result);
}

// 更新 Agent 设置（人设、对话模式等）
function updateAgentSettings(agentId, settings) {
  const agent = getAgentById(agentId);
  if (!agent) return null;

  const updates = [];
  const values = [];

  if (settings.name !== undefined) {
    updates.push('name = ?');
    values.push(settings.name);
  }
  if (settings.persona !== undefined) {
    updates.push('persona = ?');
    values.push(settings.persona);
  }
  if (settings.conversation_mode !== undefined) {
    updates.push('conversation_mode = ?');
    values.push(settings.conversation_mode);
  }
  if (settings.custom_settings !== undefined) {
    updates.push('custom_settings = ?');
    values.push(JSON.stringify(settings.custom_settings));
  }
  if (settings.history_limit !== undefined) {
    updates.push('history_limit = ?');
    values.push(settings.history_limit);
  }
  if (settings.message_filter !== undefined) {
    updates.push('message_filter = ?');
    values.push(settings.message_filter);
  }
  if (settings.keywords !== undefined) {
    updates.push('keywords = ?');
    values.push(JSON.stringify(settings.keywords));
  }

  if (updates.length === 0) return agent;

  values.push(agentId);
  db.run(`UPDATE agent_configs SET ${updates.join(', ')} WHERE id = ?`, values);

  // 同步名称到 join_requests 表
  if (settings.name !== undefined) {
    db.run(
      `UPDATE join_requests SET display_name = ? WHERE agent_id = ? AND status = 'active'`,
      [settings.name, agentId]
    );
  }

  save();

  console.log(`[DB] Agent ${agentId} 设置已更新:`, Object.keys(settings).join(', '));
  return getAgentById(agentId);
}

// 获取 Agent 完整配置（包括解析后的 JSON 字段）
function getAgentFullConfig(agentId) {
  const agent = getAgentById(agentId);
  if (!agent) return null;

  // 解析 JSON 字段
  agent.keywords = safeParseJson(agent.keywords, []);
  agent.custom_settings = safeParseJson(agent.custom_settings, {});

  return agent;
}

// 从配置文件加载Agent
function loadAgentsFromConfig() {
  const configPath = path.join(__dirname, '../../config/agents.json');
  if (fs.existsSync(configPath)) {
    try {
      const content = fs.readFileSync(configPath, 'utf8');
      const config = JSON.parse(content);
      if (config.agents && Array.isArray(config.agents)) {
        for (const agent of config.agents) {
          addAgent(agent);
        }
        console.log(`[DB] 从配置文件加载了 ${config.agents.length} 个Agent`);
      }
    } catch (e) {
      console.error('[DB] 加载Agent配置失败:', e.message);
    }
  }
}

// 配置文件热更新回调
let onConfigChangeCallback = null;

function setConfigChangeCallback(callback) {
  onConfigChangeCallback = callback;
}

// 启动配置文件监听
function startConfigWatcher() {
  const configPath = path.join(__dirname, '../../config/agents.json');

  let lastReload = 0;
  const RELOAD_DEBOUNCE = 1000; // 1秒防抖

  // 创建config目录（如果不存在）
  const configDir = path.dirname(configPath);
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  // 创建默认配置文件（如果不存在）
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, JSON.stringify({ agents: [] }, null, 2));
    console.log('[DB] 创建默认配置文件');
  }

  fs.watch(configPath, (eventType) => {
    if (eventType === 'change') {
      const now = Date.now();
      if (now - lastReload < RELOAD_DEBOUNCE) return;
      lastReload = now;

      console.log('[DB] 检测到配置文件变化，重新加载...');
      loadAgentsFromConfig();

      // 通知回调
      if (onConfigChangeCallback) {
        onConfigChangeCallback();
      }
    }
  });

  console.log('[DB] 配置文件热更新已启用');
}

// 默认系统设置
const defaultSettings = {
  // Agent回复模式：strict_mention（仅@时回复）、moderate（适度参与）、active（积极参与）
  agent_reply_mode: {
    value: 'active',  // 默认积极模式，让Agent更活跃
    description: 'Agent回复模式：strict_mention(仅@时回复)、moderate(适度参与)、active(积极参与)'
  },
  // Agent冷却时间（毫秒）- 降低到3秒，避免错过回答
  agent_cooldown_ms: {
    value: 3000,
    description: 'Agent回复冷却时间（毫秒），设置较短以避免错过回答'
  },
  // 连续消息限制 - 提高上限
  max_consecutive_msg: {
    value: 10,
    description: 'Agent连续发送消息的最大数量'
  },
  // 是否允许Agent之间互相回复
  allow_agent_to_agent: {
    value: true,
    description: '是否允许Agent之间互相回复'
  },
  // 用户授权关键词
  auth_keywords: {
    value: ['继续', '请继续', 'go on', 'continue', '/allow-chat'],
    description: '用户授权Agent持续对话的关键词'
  },
  // 回复延时范围（毫秒）- 缩短延时
  reply_delay_range: {
    value: { min: 500, max: 2000 },
    description: 'Agent回复延时范围（毫秒），模拟人类思考时间'
  }
};

// 初始化默认设置
function initDefaultSettings() {
  for (const [key, setting] of Object.entries(defaultSettings)) {
    const result = db.exec('SELECT key FROM system_settings WHERE key = ?', [key]);
    if (result.length === 0 || result[0].values.length === 0) {
      db.run(
        'INSERT INTO system_settings (key, value, description) VALUES (?, ?, ?)',
        [key, JSON.stringify(setting.value), setting.description]
      );
    }
  }
  console.log('[DB] 系统设置初始化完成');
}

// 获取单个设置
function getSetting(key) {
  const result = db.exec('SELECT value FROM system_settings WHERE key = ?', [key]);
  if (result.length === 0 || result[0].values.length === 0) {
    // 返回默认值
    if (defaultSettings[key]) {
      return defaultSettings[key].value;
    }
    return null;
  }
  try {
    return JSON.parse(result[0].values[0][0]);
  } catch (e) {
    return result[0].values[0][0];
  }
}

// 获取所有设置
function getAllSettings() {
  const result = db.exec('SELECT key, value, description FROM system_settings');
  const settings = {};

  if (result.length > 0) {
    const columns = result[0].columns;
    result[0].values.forEach(values => {
      const row = {};
      columns.forEach((col, i) => row[col] = values[i]);
      try {
        row.value = JSON.parse(row.value);
      } catch (e) {
        // 保持原始值
      }
      settings[row.key] = {
        value: row.value,
        description: row.description
      };
    });
  }

  return settings;
}

// 更新设置
function updateSetting(key, value) {
  db.run(
    "UPDATE system_settings SET value = ?, updated_at = datetime('now') WHERE key = ?",
    [JSON.stringify(value), key]
  );
  save();
  return true;
}

// 批量更新设置
function updateSettings(settings) {
  for (const [key, value] of Object.entries(settings)) {
    db.run(
      "UPDATE system_settings SET value = ?, updated_at = datetime('now') WHERE key = ?",
      [JSON.stringify(value), key]
    );
  }
  save();
  return true;
}

// ==================== 话题相关操作 ====================

// 创建话题
function createTopic(title, description, createdBy, messageIds) {
  const id = uuidv4();
  const now = formatShanghaiTime(new Date());

  const result = db.run(
    'INSERT INTO topics (id, title, description, created_by, created_at) VALUES (?, ?, ?, ?, ?)',
    [id, title, description || null, createdBy, now]
  );

  // sql.js 的 db.run() 返回对象，检查是否有错误
  if (result && result.error) {
    console.error(`[DB] 创建话题失败:`, result.error);
    throw new Error('创建话题失败: ' + (result.error.message || result.error));
  }

  console.log(`[DB] 话题创建成功: ${id} - ${title}`);

  // 如果有消息IDs，复制消息到话题消息表
  let actualCount = 0;
  if (messageIds && messageIds.length > 0) {
    // 获取原始消息
    const placeholders = messageIds.map(() => '?').join(',');
    const msgResult = db.exec(
      `SELECT id, sender_id, sender_name, sender_type, content, created_at FROM messages WHERE id IN (${placeholders}) ORDER BY id`,
      messageIds
    );

    if (msgResult.length > 0) {
      const columns = msgResult[0].columns;
      msgResult[0].values.forEach((values, index) => {
        const msg = {};
        columns.forEach((col, i) => msg[col] = values[i]);

        const insertResult = db.run(
          `INSERT INTO topic_messages (topic_id, original_message_id, sender_id, sender_name, sender_type, content, original_created_at, sequence) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, msg.id, msg.sender_id, msg.sender_name, msg.sender_type, msg.content, msg.created_at, index]
        );

        if (insertResult && insertResult.error) {
          console.error(`[DB] 插入话题消息失败:`, insertResult.error);
        } else {
          actualCount++;
        }
      });
    }
    console.log(`[DB] 已复制 ${actualCount}/${messageIds.length} 条消息到话题`);
  }

  save();

  return {
    id,
    title,
    description,
    created_by: createdBy,
    created_at: now,
    message_count: actualCount
  };
}

// 获取所有话题列表
function getTopics(limit = 50, offset = 0) {
  try {
    const result = db.exec(
      `SELECT t.id, t.title, t.description, t.created_by, t.created_at, t.status,
              (SELECT COUNT(*) FROM topic_messages WHERE topic_id = t.id) as message_count,
              (SELECT content FROM topic_summaries WHERE topic_id = t.id ORDER BY created_at DESC LIMIT 1) as has_summary
       FROM topics t
       ORDER BY t.created_at DESC
       LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    const topics = parseMultipleResults(result);
    console.log(`[DB] 查询到 ${topics.length} 个话题`);
    return topics;
  } catch (e) {
    console.error('[DB] 查询话题列表失败:', e.message);
    return [];
  }
}

// 获取话题详情
function getTopicById(topicId) {
  const result = db.exec(
    `SELECT t.id, t.title, t.description, t.created_by, t.created_at, t.status,
            (SELECT COUNT(*) FROM topic_messages WHERE topic_id = t.id) as message_count
     FROM topics t
     WHERE t.id = ?`,
    [topicId]
  );

  return parseSingleResult(result);
}

// 获取话题消息列表
function getTopicMessages(topicId) {
  const result = db.exec(
    `SELECT id, original_message_id, sender_id, sender_name, sender_type, content, original_created_at, sequence
     FROM topic_messages
     WHERE topic_id = ?
     ORDER BY sequence ASC`,
    [topicId]
  );

  return parseMultipleResults(result);
}

// 添加消息到话题
function addMessagesToTopic(topicId, messageIds) {
  if (!messageIds || messageIds.length === 0) return 0;

  // 获取话题当前最大sequence
  const maxSeqResult = db.exec(
    'SELECT MAX(sequence) FROM topic_messages WHERE topic_id = ?',
    [topicId]
  );
  let nextSeq = 0;
  if (maxSeqResult.length > 0 && maxSeqResult[0].values.length > 0) {
    nextSeq = maxSeqResult[0].values[0][0] || 0;
  }

  // 获取原始消息
  const placeholders = messageIds.map(() => '?').join(',');
  const result = db.exec(
    `SELECT id, sender_id, sender_name, sender_type, content, created_at FROM messages WHERE id IN (${placeholders}) ORDER BY id`,
    messageIds
  );

  let added = 0;
  if (result.length > 0) {
    const columns = result[0].columns;
    result[0].values.forEach((values) => {
      const msg = {};
      columns.forEach((col, i) => msg[col] = values[i]);

      // 检查是否已存在
      const existsResult = db.exec(
        'SELECT id FROM topic_messages WHERE topic_id = ? AND original_message_id = ?',
        [topicId, msg.id]
      );

      if (existsResult.length === 0 || existsResult[0].values.length === 0) {
        db.run(
          `INSERT INTO topic_messages (topic_id, original_message_id, sender_id, sender_name, sender_type, content, original_created_at, sequence) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [topicId, msg.id, msg.sender_id, msg.sender_name, msg.sender_type, msg.content, msg.created_at, nextSeq++]
        );
        added++;
      }
    });
  }

  save();
  return added;
}

// 更新话题
function updateTopic(topicId, title, description) {
  db.run(
    'UPDATE topics SET title = ?, description = ? WHERE id = ?',
    [title, description || null, topicId]
  );
  save();
  return true;
}

// 删除话题
function deleteTopic(topicId) {
  db.run('DELETE FROM topics WHERE id = ?', [topicId]);
  save();
  return true;
}

// 保存话题总结
function saveTopicSummary(topicId, narrative, viewpoints, consensus, openQuestions) {
  const now = formatShanghaiTime(new Date());

  // 先删除旧总结
  db.run('DELETE FROM topic_summaries WHERE topic_id = ?', [topicId]);

  db.run(
    `INSERT INTO topic_summaries (topic_id, narrative, viewpoints, consensus, open_questions, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [topicId, narrative, JSON.stringify(viewpoints), consensus, JSON.stringify(openQuestions), now]
  );

  save();

  return {
    topic_id: topicId,
    narrative,
    viewpoints,
    consensus,
    open_questions,
    created_at: now
  };
}

// 获取话题总结
function getTopicSummary(topicId) {
  const result = db.exec(
    'SELECT id, topic_id, narrative, viewpoints, consensus, open_questions, created_at FROM topic_summaries WHERE topic_id = ? ORDER BY created_at DESC LIMIT 1',
    [topicId]
  );

  const summary = parseSingleResult(result);
  if (!summary) return null;

  // 解析 JSON 字段
  summary.viewpoints = safeParseJson(summary.viewpoints, summary.viewpoints);
  summary.open_questions = safeParseJson(summary.open_questions, summary.open_questions);

  return summary;
}

// 获取消息用于导出（根据ID列表）
function getMessagesByIds(messageIds) {
  if (!messageIds || messageIds.length === 0) return [];

  const placeholders = messageIds.map(() => '?').join(',');
  const result = db.exec(
    `SELECT id, sender_id, sender_name, sender_type, content, created_at FROM messages WHERE id IN (${placeholders}) ORDER BY id`,
    messageIds
  );

  return parseMultipleResults(result);
}

// ==================== Agent 接入申请相关操作 ====================

// 创建接入申请
function createJoinRequest(request) {
  const requestId = request.request_id || `req_${uuidv4().replace(/-/g, '').substring(0, 12)}`;
  const now = formatShanghaiTime(new Date());
  // 默认 24 小时过期
  const expiresAt = formatShanghaiTime(new Date(Date.now() + 24 * 60 * 60 * 1000));

  db.run(
    `INSERT INTO join_requests (
      request_id, agent_id, proposed_name, runtime_type, connector_version,
      bootstrap_token, capabilities, description, source_host, source_instance, metadata,
      status, submitted_at, expires_at, last_seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
    [
      requestId,
      request.agent_id,
      request.proposed_name || request.agent_id,
      request.runtime_type || 'generic-ws',
      request.connector_version || null,
      request.bootstrap_token || null,
      request.capabilities ? JSON.stringify(request.capabilities) : null,
      request.description || null,
      request.source_host || null,
      request.source_instance || null,
      request.metadata ? JSON.stringify(request.metadata) : null,
      now,
      expiresAt,
      now
    ]
  );

  save();
  console.log(`[DB] 创建接入申请: ${requestId} - ${request.proposed_name}`);

  return getJoinRequestById(requestId);
}

// 通过 ID 获取接入申请
function getJoinRequestById(requestId) {
  const result = db.exec('SELECT * FROM join_requests WHERE request_id = ?', [requestId]);
  if (result.length === 0 || result[0].values.length === 0) return null;

  return parseJoinRequest(result);
}

// 通过 agent_id 获取接入申请（pending 或 approved 状态）
function getJoinRequestByAgentId(agentId) {
  const result = db.exec(
    "SELECT * FROM join_requests WHERE agent_id = ? AND status IN ('pending', 'approved') ORDER BY submitted_at DESC LIMIT 1",
    [agentId]
  );
  if (result.length === 0 || result[0].values.length === 0) return null;

  return parseJoinRequest(result);
}

// 通过 agent_id 获取活跃状态的接入申请（用于快速重连）
function getActiveJoinRequestByAgentId(agentId) {
  const result = db.exec(
    "SELECT * FROM join_requests WHERE agent_id = ? AND status = 'active' ORDER BY approved_at DESC LIMIT 1",
    [agentId]
  );
  if (result.length === 0 || result[0].values.length === 0) return null;

  return parseJoinRequest(result);
}

// 获取指定状态的接入申请列表
function getJoinRequestsByStatus(status, limit = 50) {
  let query = 'SELECT * FROM join_requests';
  const params = [];

  if (status) {
    query += ' WHERE status = ?';
    params.push(status);
  }

  query += ' ORDER BY submitted_at DESC LIMIT ?';
  params.push(limit);

  const result = db.exec(query, params);
  if (result.length === 0) return [];

  return parseJoinRequests(result);
}

// 获取所有待审核的接入申请
function getPendingJoinRequests() {
  return getJoinRequestsByStatus('pending');
}

// 获取所有接入申请
function getAllJoinRequests(limit = 100) {
  const result = db.exec('SELECT * FROM join_requests ORDER BY submitted_at DESC LIMIT ?', [limit]);
  if (result.length === 0) return [];
  return parseJoinRequests(result);
}

// 更新接入申请状态
function updateJoinRequestStatus(requestId, status, updates = {}) {
  const now = formatShanghaiTime(new Date());
  const fields = ['status = ?', 'last_seen_at = ?'];
  const values = [status, now];

  if (updates.display_name !== undefined) {
    fields.push('display_name = ?');
    values.push(updates.display_name);
  }
  if (updates.connection_secret !== undefined) {
    fields.push('connection_secret = ?');
    values.push(updates.connection_secret);
  }
  if (updates.activation_expires_at !== undefined) {
    fields.push('activation_expires_at = ?');
    values.push(updates.activation_expires_at);
  }
  if (updates.approved_by !== undefined) {
    fields.push('approved_by = ?');
    values.push(updates.approved_by);
  }
  if (updates.approved_at !== undefined) {
    fields.push('approved_at = ?');
    values.push(updates.approved_at);
  }
  if (updates.rejected_reason !== undefined) {
    fields.push('rejected_reason = ?');
    values.push(updates.rejected_reason);
  }
  if (updates.notes !== undefined) {
    fields.push('notes = ?');
    values.push(updates.notes);
  }

  values.push(requestId);
  db.run(`UPDATE join_requests SET ${fields.join(', ')} WHERE request_id = ?`, values);
  save();

  return getJoinRequestById(requestId);
}

// 批准接入申请
function approveJoinRequest(requestId, approvedBy, platformConfig = {}) {
  const now = formatShanghaiTime(new Date());
  // 生成连接密钥
  const connectionSecret = `cs_${uuidv4().replace(/-/g, '')}`;
  // 激活窗口 7 天
  const activationExpiresAt = formatShanghaiTime(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));

  db.run(
    `UPDATE join_requests SET
      status = 'approved',
      display_name = ?,
      target_room = ?,
      receive_mode = ?,
      capability_scope = ?,
      notes = ?,
      approved_by = ?,
      approved_at = ?,
      connection_secret = ?,
      activation_expires_at = ?,
      last_seen_at = ?
    WHERE request_id = ?`,
    [
      platformConfig.display_name || null,
      platformConfig.target_room || 'main',
      platformConfig.receive_mode || 'free',
      platformConfig.capability_scope ? JSON.stringify(platformConfig.capability_scope) : null,
      platformConfig.notes || null,
      approvedBy,
      now,
      connectionSecret,
      activationExpiresAt,
      now,
      requestId
    ]
  );

  save();
  console.log(`[DB] 接入申请已批准: ${requestId} by ${approvedBy}`);

  return getJoinRequestById(requestId);
}

// 拒绝接入申请
function rejectJoinRequest(requestId, reason, rejectedBy = 'system') {
  const now = formatShanghaiTime(new Date());

  db.run(
    `UPDATE join_requests SET status = 'rejected', rejected_reason = ?, approved_by = ?, approved_at = ?, last_seen_at = ? WHERE request_id = ?`,
    [reason || '未提供原因', rejectedBy, now, now, requestId]
  );

  save();
  console.log(`[DB] 接入申请已拒绝: ${requestId} - ${reason}`);

  return getJoinRequestById(requestId);
}

// 激活 Agent（完成最终握手）
function activateJoinRequest(requestId, sessionId) {
  const now = formatShanghaiTime(new Date());

  db.run(
    `UPDATE join_requests SET status = 'active', activation_session_id = ?, last_seen_at = ? WHERE request_id = ?`,
    [sessionId, now, requestId]
  );

  // 同步到 agent_configs 表，使其在聊天页面显示
  const request = getJoinRequestById(requestId);
  if (request) {
    addAgent({
      id: request.agent_id,
      name: request.display_name || request.proposed_name,
      token: request.connection_secret,
      message_filter: request.receive_mode || 'all',
      history_limit: 50
    });
  }

  save();
  console.log(`[DB] Agent 已激活: ${requestId}`);

  return request;
}

// 清理过期的接入申请
function cleanExpiredJoinRequests() {
  const now = formatShanghaiTime(new Date());

  // 获取即将过期的申请
  const expiredResult = db.exec(
    "SELECT request_id, agent_id, proposed_name FROM join_requests WHERE status IN ('pending', 'approved') AND expires_at < ?",
    [now]
  );

  if (expiredResult.length > 0) {
    expiredResult[0].values.forEach(row => {
      console.log(`[DB] 接入申请已过期: ${row[0]} - ${row[2]}`);
    });
  }

  // 标记为过期
  db.run(
    "UPDATE join_requests SET status = 'expired' WHERE status IN ('pending', 'approved') AND expires_at < ?",
    [now]
  );

  // 清理激活窗口过期的
  const activationExpiredResult = db.exec(
    "SELECT request_id, agent_id FROM join_requests WHERE status = 'approved' AND activation_expires_at < ?",
    [now]
  );

  if (activationExpiredResult.length > 0) {
    activationExpiredResult[0].values.forEach(row => {
      console.log(`[DB] 激活窗口已过期: ${row[0]} - ${row[1]}`);
    });
  }

  db.run(
    "UPDATE join_requests SET status = 'expired' WHERE status = 'approved' AND activation_expires_at < ?",
    [now]
  );

  save();

  return {
    expired: expiredResult.length > 0 ? expiredResult[0].values.length : 0,
    activationExpired: activationExpiredResult.length > 0 ? activationExpiredResult[0].values.length : 0
  };
}

// 更新 last_seen_at
function updateJoinRequestLastSeen(requestId) {
  const now = formatShanghaiTime(new Date());
  db.run('UPDATE join_requests SET last_seen_at = ? WHERE request_id = ?', [now, requestId]);
  // 不立即 save，由调用方决定
}

// 删除 Agent 及所有相关数据
function deleteAgent(agentId) {
  // 获取 Agent 信息用于日志
  const agent = getAgentById(agentId);

  // 删除 agent_configs 中的记录
  db.run('DELETE FROM agent_configs WHERE id = ?', [agentId]);

  // 删除 join_requests 中的所有相关记录
  db.run('DELETE FROM join_requests WHERE agent_id = ?', [agentId]);

  save();

  if (agent) {
    console.log(`[DB] Agent 已删除: ${agentId} (${agent.name})`);
  }

  return { success: true, deletedAgent: agent };
}

// 通用更新函数
function updateJoinRequest(requestId, updates) {
  const fields = [];
  const values = [];

  for (const [key, value] of Object.entries(updates)) {
    fields.push(`${key} = ?`);
    values.push(value);
  }

  if (fields.length === 0) return null;

  values.push(requestId);
  db.run(`UPDATE join_requests SET ${fields.join(', ')} WHERE request_id = ?`, values);
  save();

  return getJoinRequestById(requestId);
}

// 解析单个 join_request
function parseJoinRequest(result) {
  const request = parseSingleResult(result);
  if (!request) return null;

  // 解析 JSON 字段
  return parseJsonFields(request, ['capabilities', 'metadata', 'capability_scope']);
}

// 解析多个 join_requests
function parseJoinRequests(result) {
  const requests = parseMultipleResults(result);
  return requests.map(req => parseJsonFields(req, ['capabilities', 'metadata', 'capability_scope']));
}

// 清理非 active 状态的 join_requests
function cleanupJoinRequests() {
  db.run("DELETE FROM join_requests WHERE status != 'active'");
  save();
  console.log('[DB] 已清理非 active 状态的 join_requests');
}

// 清理孤立的 join_requests（对应的 agent_config 已删除）
function cleanupOrphanJoinRequests() {
  const agents = module.exports.getAllAgents();
  const agentIds = new Set(agents.map(a => a.id));

  const requests = module.exports.getAllJoinRequests();
  let deleted = 0;
  for (const r of requests) {
    if (!agentIds.has(r.agent_id)) {
      db.run('DELETE FROM join_requests WHERE request_id = ?', [r.request_id]);
      deleted++;
    }
  }
  if (deleted > 0) {
    save();
    console.log(`[DB] 已清理 ${deleted} 条孤立的 join_requests`);
  }
  return deleted;
}

// ==================== 平台治理相关操作 ====================

// 解析规则 JSON 字段
function parseRule(rule) {
  if (!rule) return null;
  return parseJsonFields(rule, ['trigger', 'must', 'must_not']);
}

// 解析技能 JSON 字段
function parseSkill(skill) {
  if (!skill) return null;
  return parseJsonFields(skill, ['input_schema', 'output_schema']);
}

// 解析能力包 JSON 字段
function parsePack(pack) {
  if (!pack) return null;
  return parseJsonFields(pack, ['skills', 'state_fields', 'trigger_keywords']);
}

// ===== 规则 CRUD =====

function getAllRules() {
  const result = db.exec('SELECT * FROM platform_rules ORDER BY priority DESC');
  return parseMultipleResults(result).map(parseRule);
}

function getRuleById(id) {
  const result = db.exec('SELECT * FROM platform_rules WHERE id = ?', [id]);
  return parseRule(parseSingleResult(result));
}

function getActiveRules() {
  const result = db.exec('SELECT * FROM platform_rules WHERE enabled = 1 ORDER BY priority DESC');
  return parseMultipleResults(result).map(parseRule);
}

function createRule(rule) {
  const now = formatShanghaiTime(new Date());
  db.run(
    `INSERT INTO platform_rules (id, summary, trigger, must, must_not, priority, version, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    [rule.id, rule.summary, JSON.stringify(rule.trigger),
     rule.must ? JSON.stringify(rule.must) : null,
     rule.must_not ? JSON.stringify(rule.must_not) : null,
     rule.priority || 100, rule.version || '1.0', now, now]
  );
  save();
  return getRuleById(rule.id);
}

function updateRule(id, updates) {
  const fields = [];
  const values = [];
  if (updates.summary) { fields.push('summary = ?'); values.push(updates.summary); }
  if (updates.trigger) { fields.push('trigger = ?'); values.push(JSON.stringify(updates.trigger)); }
  if (updates.must) { fields.push('must = ?'); values.push(JSON.stringify(updates.must)); }
  if (updates.must_not) { fields.push('must_not = ?'); values.push(JSON.stringify(updates.must_not)); }
  if (updates.priority) { fields.push('priority = ?'); values.push(updates.priority); }
  if (updates.enabled !== undefined) { fields.push('enabled = ?'); values.push(updates.enabled ? 1 : 0); }
  fields.push('updated_at = ?');
  values.push(formatShanghaiTime(new Date()));
  values.push(id);

  if (fields.length > 1) {
    db.run(`UPDATE platform_rules SET ${fields.join(', ')} WHERE id = ?`, values);
    save();
  }
  return getRuleById(id);
}

function deleteRule(id) {
  db.run('DELETE FROM platform_rules WHERE id = ?', [id]);
  save();
}

// ===== 技能 CRUD =====

function getAllSkills() {
  const result = db.exec('SELECT * FROM platform_skills ORDER BY category, name');
  return parseMultipleResults(result).map(parseSkill);
}

function getSkillById(id) {
  const result = db.exec('SELECT * FROM platform_skills WHERE id = ?', [id]);
  return parseSkill(parseSingleResult(result));
}

function getActiveSkills() {
  const result = db.exec('SELECT * FROM platform_skills WHERE enabled = 1 ORDER BY category, name');
  return parseMultipleResults(result).map(parseSkill);
}

function createSkill(skill) {
  const now = formatShanghaiTime(new Date());
  try {
    db.run(
      `INSERT INTO platform_skills (id, name, description, category, input_schema, output_schema, usage_hint, version, enabled, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [skill.id, skill.name, skill.description || null, skill.category || null,
       skill.input_schema ? JSON.stringify(skill.input_schema) : null,
       skill.output_schema ? JSON.stringify(skill.output_schema) : null,
       skill.usage_hint || null, skill.version || '1.0', now]
    );
    save();
    return getSkillById(skill.id);
  } catch (e) {
    console.error('[DB] createSkill error:', e.message);
    throw e;
  }
}

function updateSkill(id, updates) {
  const fields = [];
  const values = [];
  if (updates.name) { fields.push('name = ?'); values.push(updates.name); }
  if (updates.description) { fields.push('description = ?'); values.push(updates.description); }
  if (updates.category) { fields.push('category = ?'); values.push(updates.category); }
  if (updates.input_schema) { fields.push('input_schema = ?'); values.push(JSON.stringify(updates.input_schema)); }
  if (updates.output_schema) { fields.push('output_schema = ?'); values.push(JSON.stringify(updates.output_schema)); }
  if (updates.usage_hint) { fields.push('usage_hint = ?'); values.push(updates.usage_hint); }
  if (updates.enabled !== undefined) { fields.push('enabled = ?'); values.push(updates.enabled ? 1 : 0); }
  if (fields.length > 0) {
    db.run(`UPDATE platform_skills SET ${fields.join(', ')} WHERE id = ?`, [...values, id]);
    save();
  }
  return getSkillById(id);
}

function deleteSkill(id) {
  db.run('DELETE FROM platform_skills WHERE id = ?', [id]);
  save();
}

// ===== 能力包 CRUD =====

function getAllPacks() {
  const result = db.exec('SELECT * FROM capability_packs ORDER BY name');
  return parseMultipleResults(result).map(parsePack);
}

function getPackById(id) {
  const result = db.exec('SELECT * FROM capability_packs WHERE id = ?', [id]);
  return parsePack(parseSingleResult(result));
}

function getActivePacks() {
  const result = db.exec('SELECT * FROM capability_packs WHERE enabled = 1 ORDER BY name');
  return parseMultipleResults(result).map(parsePack);
}

function createPack(pack) {
  const now = formatShanghaiTime(new Date());
  db.run(
    `INSERT INTO capability_packs (id, name, goal, skills, state_fields, trigger_keywords, version, enabled, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    [pack.id, pack.name, pack.goal,
     pack.skills ? JSON.stringify(pack.skills) : null,
     pack.state_fields ? JSON.stringify(pack.state_fields) : null,
     pack.trigger_keywords ? JSON.stringify(pack.trigger_keywords) : null,
     pack.version || '1.0', now]
  );
  save();
  return getPackById(pack.id);
}

function updatePack(id, updates) {
  const fields = [];
  const values = [];
  if (updates.name) { fields.push('name = ?'); values.push(updates.name); }
  if (updates.goal) { fields.push('goal = ?'); values.push(updates.goal); }
  if (updates.skills) { fields.push('skills = ?'); values.push(JSON.stringify(updates.skills)); }
  if (updates.state_fields) { fields.push('state_fields = ?'); values.push(JSON.stringify(updates.state_fields)); }
  if (updates.trigger_keywords) { fields.push('trigger_keywords = ?'); values.push(JSON.stringify(updates.trigger_keywords)); }
  if (updates.enabled !== undefined) { fields.push('enabled = ?'); values.push(updates.enabled ? 1 : 0); }
  if (fields.length > 0) {
    db.run(`UPDATE capability_packs SET ${fields.join(', ')} WHERE id = ?`, [...values, id]);
    save();
  }
  return getPackById(id);
}

function deletePack(id) {
  db.run('DELETE FROM capability_packs WHERE id = ?', [id]);
  save();
}

// ===== Agent 技能声明 =====

function getAgentSkillDeclaration(agentId) {
  const result = db.exec('SELECT * FROM agent_skill_declarations WHERE agent_id = ?', [agentId]);
  const row = parseSingleResult(result);
  if (!row) return null;
  return parseJsonFields(row, ['declared_skills']);
}

function setAgentSkillDeclaration(agentId, skills) {
  const existing = getAgentSkillDeclaration(agentId);
  const now = formatShanghaiTime(new Date());
  if (existing) {
    db.run(
      'UPDATE agent_skill_declarations SET declared_skills = ?, updated_at = ? WHERE agent_id = ?',
      [JSON.stringify(skills), now, agentId]
    );
  } else {
    db.run(
      'INSERT INTO agent_skill_declarations (agent_id, declared_skills, updated_at) VALUES (?, ?, ?)',
      [agentId, JSON.stringify(skills), now]
    );
  }
  save();
  return getAgentSkillDeclaration(agentId);
}

// ===== 规则审计日志 =====

function logRuleAudit(log) {
  const now = formatShanghaiTime(new Date());
  db.run(
    `INSERT INTO rule_audit_logs (rule_id, message_id, agent_id, trigger_context, action_taken, result, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [log.rule_id, log.message_id, log.agent_id,
     log.trigger_context ? JSON.stringify(log.trigger_context) : null,
     log.action_taken ? JSON.stringify(log.action_taken) : null,
     log.result, now]
  );
  save();
}

function getRuleAuditLogs(limit = 100) {
  const result = db.exec('SELECT * FROM rule_audit_logs ORDER BY created_at DESC LIMIT ?', [limit]);
  return parseMultipleResults(result).map(log => parseJsonFields(log, ['trigger_context', 'action_taken']));
}

function getRuleAuditLogsByRule(ruleId, limit = 50) {
  const result = db.exec('SELECT * FROM rule_audit_logs WHERE rule_id = ? ORDER BY created_at DESC LIMIT ?', [ruleId, limit]);
  return parseMultipleResults(result).map(log => parseJsonFields(log, ['trigger_context', 'action_taken']));
}

// ===== 技能调用日志 =====

function logSkillCall(log) {
  const now = formatShanghaiTime(new Date());
  db.run(
    `INSERT INTO skill_call_logs (skill_id, caller_id, input_params, output_result, status, duration_ms, error_message, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [log.skill_id, log.caller_id,
     log.input_params ? JSON.stringify(log.input_params) : null,
     log.output_result ? JSON.stringify(log.output_result) : null,
     log.status, log.duration_ms, log.error_message, now]
  );
  save();
}

function getSkillCallLogs(limit = 100) {
  const result = db.exec('SELECT * FROM skill_call_logs ORDER BY created_at DESC LIMIT ?', [limit]);
  return parseMultipleResults(result).map(log => parseJsonFields(log, ['input_params', 'output_result']));
}

function getSkillCallLogsBySkill(skillId, limit = 50) {
  const result = db.exec('SELECT * FROM skill_call_logs WHERE skill_id = ? ORDER BY created_at DESC LIMIT ?', [skillId, limit]);
  return parseMultipleResults(result).map(log => parseJsonFields(log, ['input_params', 'output_result']));
}

// ===== 场景状态 =====

function parseSceneState(scene) {
  if (!scene) return null;
  return parseJsonFields(scene, ['participants', 'state_data']);
}

function getActiveScene(sceneId) {
  const result = db.exec('SELECT * FROM scene_states WHERE scene_id = ? AND status = ?', [sceneId, 'active']);
  return parseSceneState(parseSingleResult(result));
}

function getActiveScenes() {
  const result = db.exec('SELECT * FROM scene_states WHERE status = ?', ['active']);
  return parseMultipleResults(result).map(parseSceneState);
}

function createSceneState(scene) {
  const now = formatShanghaiTime(new Date());
  const expiresAt = scene.expires_at || formatShanghaiTime(new Date(Date.now() + 30 * 60 * 1000)); // 30分钟默认
  db.run(
    `INSERT INTO scene_states (scene_id, pack_id, status, participants, state_data, created_at, expires_at)
     VALUES (?, ?, 'active', ?, ?, ?, ?)`,
    [scene.scene_id, scene.pack_id,
     scene.participants ? JSON.stringify(scene.participants) : null,
     scene.state_data ? JSON.stringify(scene.state_data) : null,
     now, expiresAt]
  );
  save();
  return getActiveScene(scene.scene_id);
}

function updateSceneState(sceneId, updates) {
  const fields = [];
  const values = [];
  if (updates.status) { fields.push('status = ?'); values.push(updates.status); }
  if (updates.participants) { fields.push('participants = ?'); values.push(JSON.stringify(updates.participants)); }
  if (updates.state_data) { fields.push('state_data = ?'); values.push(JSON.stringify(updates.state_data)); }
  if (updates.expires_at) { fields.push('expires_at = ?'); values.push(updates.expires_at); }
  if (fields.length > 0) {
    db.run(`UPDATE scene_states SET ${fields.join(', ')} WHERE scene_id = ?`, [...values, sceneId]);
    save();
  }
  return getActiveScene(sceneId);
}

function endScene(sceneId) {
  db.run('UPDATE scene_states SET status = ? WHERE scene_id = ?', ['completed', sceneId]);
  save();
}

// ===== 治理提案 =====

function parseProposal(proposal) {
  if (!proposal) return null;
  return parseJsonFields(proposal, ['content']);
}

function getAllProposals() {
  const result = db.exec('SELECT * FROM governance_proposals ORDER BY created_at DESC');
  return parseMultipleResults(result).map(parseProposal);
}

function getProposalById(id) {
  const result = db.exec('SELECT * FROM governance_proposals WHERE id = ?', [id]);
  return parseProposal(parseSingleResult(result));
}

function getPendingProposals() {
  const result = db.exec('SELECT * FROM governance_proposals WHERE status = ? ORDER BY created_at DESC', ['pending']);
  return parseMultipleResults(result).map(parseProposal);
}

function createProposal(proposal) {
  const now = formatShanghaiTime(new Date());
  const id = proposal.id || uuidv4();
  db.run(
    `INSERT INTO governance_proposals (id, target_type, target_id, action, content, status, proposer, created_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
    [id, proposal.target_type, proposal.target_id, proposal.action,
     JSON.stringify(proposal.content), proposal.proposer, now]
  );
  save();
  return getProposalById(id);
}

function reviewProposal(id, reviewedBy, approved) {
  const now = formatShanghaiTime(new Date());
  const status = approved ? 'approved' : 'rejected';
  db.run(
    'UPDATE governance_proposals SET status = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?',
    [status, reviewedBy, now, id]
  );
  save();
  return getProposalById(id);
}

// ===== 变更历史 =====

function logGovernanceChange(change) {
  const now = formatShanghaiTime(new Date());
  db.run(
    `INSERT INTO governance_changelog (entity_type, entity_id, action, old_value, new_value, changed_by, changed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [change.entity_type, change.entity_id, change.action,
     change.old_value ? JSON.stringify(change.old_value) : null,
     change.new_value ? JSON.stringify(change.new_value) : null,
     change.changed_by, now]
  );
  save();
}

function getGovernanceChangelog(entityType, entityId, limit = 50) {
  const result = db.exec(
    'SELECT * FROM governance_changelog WHERE entity_type = ? AND entity_id = ? ORDER BY changed_at DESC LIMIT ?',
    [entityType, entityId, limit]
  );
  return parseMultipleResults(result).map(change => parseJsonFields(change, ['old_value', 'new_value']));
}

// ===== 初始化默认数据 =====

function initDefaultGovernanceData() {
  // 检查是否已有规则
  const existingRules = db.exec('SELECT COUNT(*) FROM platform_rules');
  if (existingRules[0].values[0][0] > 0) return;

  // 添加初始规则集
  const defaultRules = [
    { id: 'mention_reply', summary: '被@点名必须回应', trigger: { mentioned: true }, must: { set: { reply_required: true } }, priority: 100 },
    { id: 'fact_lock', summary: '有人声明在查，其他人不抢', trigger: { 'locks.fact_check': 'exists' }, must: { add_action: 'wait' }, priority: 90 },
    { id: 'cooldown', summary: '回复冷却时间', trigger: { 'cooldown_active': true }, must: { add_action: 'delay' }, priority: 80 }
  ];

  for (const rule of defaultRules) {
    createRule(rule);
  }

  // 添加初始技能集
  const defaultSkills = [
    { id: 'search', name: '搜索', category: 'information', description: '搜索相关信息' },
    { id: 'summarize', name: '总结', category: 'information', description: '总结内容要点' },
    { id: 'translate', name: '翻译', category: 'communication', description: '翻译内容' }
  ];

  for (const skill of defaultSkills) {
    createSkill(skill);
  }

  console.log('[DB] 已初始化默认治理数据');
}

module.exports = {
  init,
  save,
  formatShanghaiTime,
  // 用户
  createUser,
  findUserByUsername,
  findUserById,
  // 会话
  createSession,
  findSessionById,
  deleteSession,
  cleanExpiredSessions,
  // 消息
  createMessage,
  getRecentMessages,
  clearMessages,
  getMessageStats,
  getMessagesByIds,
  // Agent
  getAllAgents,
  getAgentById,
  getAgentByToken,
  addAgent,
  updateAgentSettings,
  getAgentFullConfig,
  loadAgentsFromConfig,
  startConfigWatcher,
  setConfigChangeCallback,
  // 系统设置
  getSetting,
  getAllSettings,
  updateSetting,
  updateSettings,
  // 话题相关
  createTopic,
  getTopics,
  getTopicById,
  getTopicMessages,
  addMessagesToTopic,
  updateTopic,
  deleteTopic,
  saveTopicSummary,
  getTopicSummary,
  // Agent 接入申请相关
  createJoinRequest,
  getJoinRequestById,
  getJoinRequestByAgentId,
  getActiveJoinRequestByAgentId,
  getJoinRequestsByStatus,
  getAllJoinRequests,
  updateJoinRequestStatus,
  updateJoinRequest,
  approveJoinRequest,
  rejectJoinRequest,
  activateJoinRequest,
  cleanExpiredJoinRequests,
  updateJoinRequestLastSeen,
  cleanupJoinRequests,
  cleanupOrphanJoinRequests,
  deleteAgent,
  // ===== 平台治理相关 =====
  // 规则
  getAllRules,
  getRuleById,
  getActiveRules,
  createRule,
  updateRule,
  deleteRule,
  // 技能
  getAllSkills,
  getSkillById,
  getActiveSkills,
  createSkill,
  updateSkill,
  deleteSkill,
  // 能力包
  getAllPacks,
  getPackById,
  getActivePacks,
  createPack,
  updatePack,
  deletePack,
  // Agent技能声明
  getAgentSkillDeclaration,
  setAgentSkillDeclaration,
  // 规则审计日志
  logRuleAudit,
  getRuleAuditLogs,
  getRuleAuditLogsByRule,
  // 技能调用日志
  logSkillCall,
  getSkillCallLogs,
  getSkillCallLogsBySkill,
  // 场景状态
  getActiveScene,
  getActiveScenes,
  createSceneState,
  updateSceneState,
  endScene,
  // 治理提案
  getAllProposals,
  getProposalById,
  getPendingProposals,
  createProposal,
  reviewProposal,
  // 变更历史
  logGovernanceChange,
  getGovernanceChangelog,
  // 初始化默认数据
  initDefaultGovernanceData
};
