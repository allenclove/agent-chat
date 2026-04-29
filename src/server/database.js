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

  // 迁移：topic_summaries 增加 agent 信息、用户要求、状态
  try {
    const cols = db.exec("PRAGMA table_info(topic_summaries)");
    if (cols.length > 0) {
      const colNames = cols[0].values.map(v => v[1]);
      if (!colNames.includes('agent_id')) {
        db.run('ALTER TABLE topic_summaries ADD COLUMN agent_id TEXT');
      }
      if (!colNames.includes('agent_name')) {
        db.run('ALTER TABLE topic_summaries ADD COLUMN agent_name TEXT');
      }
      if (!colNames.includes('user_instructions')) {
        db.run('ALTER TABLE topic_summaries ADD COLUMN user_instructions TEXT');
      }
      if (!colNames.includes('status')) {
        db.run("ALTER TABLE topic_summaries ADD COLUMN status TEXT DEFAULT 'active'");
      }
    }
  } catch (e) {
    console.log('[DB] topic_summaries 迁移跳过:', e.message);
  }

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

  // 场景表（统一模式管理，替代旧的 capability_packs + scene_states）
  db.run(`
    CREATE TABLE IF NOT EXISTS scenes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      icon TEXT DEFAULT '📦',
      context_prompt TEXT NOT NULL,
      trigger_keywords TEXT,
      auto_activate INTEGER DEFAULT 1,
      skills TEXT,
      enabled INTEGER DEFAULT 1,
      is_active INTEGER DEFAULT 0,
      activated_at DATETIME,
      activated_by TEXT,
      participants TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 迁移：从旧 capability_packs 导入数据
  try {
    const oldPacks = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='capability_packs'");
    if (oldPacks.length > 0 && oldPacks[0].values.length > 0) {
      const existingScenes = db.exec("SELECT COUNT(*) FROM scenes");
      if (existingScenes[0].values[0][0] === 0) {
        db.run(`INSERT INTO scenes (id, name, description, context_prompt, trigger_keywords, skills, enabled)
                SELECT id, name, goal, '场景模式: ' || name, trigger_keywords, skills, enabled
                FROM capability_packs WHERE enabled = 1`);
        console.log('[DB] 已从 capability_packs 迁移数据到 scenes 表');
      }
    }
  } catch (e) { /* 迁移跳过 */ }

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

  // 规则运行时状态表（锁、冷却等）
  db.run(`
    CREATE TABLE IF NOT EXISTS rule_runtime_state (
      state_key TEXT PRIMARY KEY,
      state_value TEXT NOT NULL,
      expires_at DATETIME,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 消息索引
  try {
    db.run('CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at)');
    db.run('CREATE INDEX IF NOT EXISTS idx_messages_sender_type ON messages(sender_type)');
    db.run('CREATE INDEX IF NOT EXISTS idx_join_requests_status ON join_requests(status)');
    db.run('CREATE INDEX IF NOT EXISTS idx_join_requests_agent_id ON join_requests(agent_id)');
  } catch (e) { /* ignore */ }

  // 启用外键约束
  try {
    db.run('PRAGMA foreign_keys = ON');
  } catch (e) { /* ignore */ }

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

function getRecentMessages(limit = 50, before = null, after = null, senderType = null) {
  let sql = 'SELECT * FROM messages WHERE 1=1';
  const params = [];

  if (before !== null && before !== undefined) {
    sql += ' AND id < ?';
    params.push(before);
  }
  if (after !== null && after !== undefined) {
    sql += ' AND id > ?';
    params.push(after);
  }
  if (senderType) {
    sql += ' AND sender_type = ?';
    params.push(senderType);
  }

  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);

  const result = db.exec(sql, params);

  if (result.length === 0) return [];

  const messages = parseMultipleResults(result);
  return messages.reverse();
}

function searchMessages(query, limit = 20) {
  if (!query || query.length < 2) return [];

  const result = db.exec(
    "SELECT * FROM messages WHERE content LIKE ? ORDER BY created_at DESC LIMIT ?",
    [`%${query}%`, limit]
  );

  if (result.length === 0) return [];
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
function getTopics(limit = 50, offset = 0, search = null) {
  try {
    let sql = `SELECT t.id, t.title, t.description, t.created_by, t.created_at, t.status,
              (SELECT COUNT(*) FROM topic_messages WHERE topic_id = t.id) as message_count,
              (SELECT agent_name FROM topic_summaries WHERE topic_id = t.id AND status = 'active' ORDER BY created_at DESC LIMIT 1) as summary_agent,
              (SELECT narrative FROM topic_summaries WHERE topic_id = t.id AND status = 'active' ORDER BY created_at DESC LIMIT 1) as has_summary
       FROM topics t`;
    const params = [];

    if (search) {
      sql += ' WHERE t.title LIKE ?';
      params.push(`%${search}%`);
    }

    sql += ' ORDER BY t.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const result = db.exec(sql, params);
    const topics = parseMultipleResults(result);
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
function saveTopicSummary(topicId, narrative, viewpoints, consensus, openQuestions, agentId = null, agentName = null, userInstructions = null) {
  const now = formatShanghaiTime(new Date());

  // 旧总结标记为 overwritten（保留历史记录）
  db.run("UPDATE topic_summaries SET status = 'overwritten' WHERE topic_id = ? AND status = 'active'", [topicId]);

  db.run(
    `INSERT INTO topic_summaries (topic_id, narrative, viewpoints, consensus, open_questions, agent_id, agent_name, user_instructions, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
    [topicId, narrative, JSON.stringify(viewpoints), consensus, JSON.stringify(openQuestions), agentId, agentName, userInstructions, now]
  );

  save();

  return {
    topic_id: topicId,
    narrative,
    viewpoints,
    consensus,
    open_questions,
    agent_id: agentId,
    agent_name: agentName,
    user_instructions: userInstructions,
    created_at: now
  };
}

// 获取话题总结（仅活跃的）
function getTopicSummary(topicId) {
  const result = db.exec(
    "SELECT id, topic_id, narrative, viewpoints, consensus, open_questions, agent_id, agent_name, user_instructions, status, created_at FROM topic_summaries WHERE topic_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1",
    [topicId]
  );

  const summary = parseSingleResult(result);
  if (!summary) return null;

  summary.viewpoints = safeParseJson(summary.viewpoints, summary.viewpoints);
  summary.open_questions = safeParseJson(summary.open_questions, summary.open_questions);

  return summary;
}

// 获取话题所有总结历史
function getAllTopicSummaries(topicId) {
  const result = db.exec(
    'SELECT id, topic_id, narrative, viewpoints, consensus, open_questions, agent_id, agent_name, user_instructions, status, created_at FROM topic_summaries WHERE topic_id = ? ORDER BY created_at DESC',
    [topicId]
  );
  const summaries = parseMultipleResults(result);
  return summaries.map(s => {
    s.viewpoints = safeParseJson(s.viewpoints, s.viewpoints);
    s.open_questions = safeParseJson(s.open_questions, s.open_questions);
    return s;
  });
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

// ===== 场景 CRUD（统一模式管理） =====

function parseScene(scene) {
  if (!scene) return null;
  return parseJsonFields(scene, ['trigger_keywords', 'skills', 'participants']);
}

function getAllScenes() {
  const result = db.exec('SELECT * FROM scenes ORDER BY name');
  return parseMultipleResults(result).map(parseScene);
}

function getSceneById(id) {
  const result = db.exec('SELECT * FROM scenes WHERE id = ?', [id]);
  return parseScene(parseSingleResult(result));
}

function getEnabledScenes() {
  const result = db.exec('SELECT * FROM scenes WHERE enabled = 1 ORDER BY name');
  return parseMultipleResults(result).map(parseScene);
}

function getActiveScene() {
  const result = db.exec('SELECT * FROM scenes WHERE is_active = 1 LIMIT 1');
  return parseScene(parseSingleResult(result));
}

function createScene(scene) {
  const now = formatShanghaiTime(new Date());
  db.run(
    `INSERT INTO scenes (id, name, description, icon, context_prompt, trigger_keywords, auto_activate, skills, enabled, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    [scene.id, scene.name, scene.description || null, scene.icon || '📦',
     scene.context_prompt, scene.trigger_keywords ? JSON.stringify(scene.trigger_keywords) : null,
     scene.auto_activate !== false ? 1 : 0,
     scene.skills ? JSON.stringify(scene.skills) : null, now]
  );
  save();
  return getSceneById(scene.id);
}

function updateScene(id, updates) {
  const fields = [];
  const values = [];
  if (updates.name) { fields.push('name = ?'); values.push(updates.name); }
  if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description); }
  if (updates.context_prompt) { fields.push('context_prompt = ?'); values.push(updates.context_prompt); }
  if (updates.trigger_keywords) { fields.push('trigger_keywords = ?'); values.push(JSON.stringify(updates.trigger_keywords)); }
  if (updates.skills) { fields.push('skills = ?'); values.push(JSON.stringify(updates.skills)); }
  if (updates.icon) { fields.push('icon = ?'); values.push(updates.icon); }
  if (updates.auto_activate !== undefined) { fields.push('auto_activate = ?'); values.push(updates.auto_activate ? 1 : 0); }
  if (updates.enabled !== undefined) { fields.push('enabled = ?'); values.push(updates.enabled ? 1 : 0); }
  if (fields.length > 0) {
    db.run(`UPDATE scenes SET ${fields.join(', ')} WHERE id = ?`, [...values, id]);
    save();
  }
  return getSceneById(id);
}

function deleteScene(id) {
  db.run('UPDATE scenes SET is_active = 0 WHERE id = ?', [id]);
  db.run('DELETE FROM scenes WHERE id = ?', [id]);
  save();
}

function activateScene(id, activatedBy, participants) {
  const now = formatShanghaiTime(new Date());
  // 先停掉当前活跃的场景
  db.run("UPDATE scenes SET is_active = 0, activated_at = NULL, activated_by = NULL, participants = NULL WHERE is_active = 1");
  // 激活新场景
  db.run(
    'UPDATE scenes SET is_active = 1, activated_at = ?, activated_by = ?, participants = ? WHERE id = ?',
    [now, activatedBy, JSON.stringify(participants || []), id]
  );
  save();
  return getSceneById(id);
}

function deactivateScene(id) {
  db.run('UPDATE scenes SET is_active = 0, activated_at = NULL, activated_by = NULL, participants = NULL WHERE id = ?', [id]);
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

function getSkillCallStats() {
  const result = db.exec('SELECT skill_id, COUNT(*) as call_count FROM skill_call_logs GROUP BY skill_id');
  if (result.length === 0) return {};
  const stats = {};
  result[0].values.forEach(row => { stats[row[0]] = row[1]; });
  return stats;
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
  const hasRules = existingRules[0].values[0][0] > 0;

  if (!hasRules) {

  // 添加初始规则集
  const defaultRules = [
    { id: 'mention_reply', summary: '被@点名必须回应', trigger: { mentioned: true }, must: { set: { reply_required: true } }, priority: 100 },
    { id: 'fact_lock', summary: '有人声明在查，其他人不抢', trigger: { 'locks.fact_check': 'exists' }, must: { add_action: 'wait' }, priority: 90 },
    { id: 'cooldown', summary: '回复冷却时间', trigger: { 'cooldown_active': true }, must: { add_action: 'delay' }, priority: 80 }
  ];

  for (const rule of defaultRules) {
    createRule(rule);
  }

  // 添加初始技能集（平台标准技能）
  const defaultSkills = [
    { id: 'search_messages', name: '搜索消息', category: 'information',
      description: '在聊天记录中按关键词搜索',
      input_schema: { type: 'object', properties: { query: { type: 'string', description: '搜索关键词' }, limit: { type: 'number', description: '返回数量上限' } }, required: ['query'] },
      output_schema: { results: [{ id: 0, sender_name: '', sender_type: '', content: '', created_at: '' }], total: 0 } },
    { id: 'get_topic', name: '查阅话题', category: 'information',
      description: '获取指定话题的完整内容：消息列表和已有总结',
      input_schema: { type: 'object', properties: { topic_id: { type: 'string', description: '话题ID' } }, required: ['topic_id'] },
      output_schema: { topic: {}, messages: [], summary: null } },
    { id: 'create_topic', name: '创建话题', category: 'action',
      description: '将指定的消息归档为一个话题，方便后续查阅和总结',
      input_schema: { type: 'object', properties: { title: { type: 'string', description: '话题标题' }, message_ids: { type: 'array', description: '消息ID列表' }, description: { type: 'string', description: '话题描述(可选)' } }, required: ['title', 'message_ids'] },
      output_schema: { topic_id: '', message_count: 0 } },
    { id: 'get_room_status', name: '房间状态', category: 'information',
      description: '查看当前房间的在线成员、活跃规则和活跃场景',
      input_schema: null,
      output_schema: { online_users: [], online_agents: [], active_rules: [], active_scenes: [] } },
    { id: 'summarize', name: '生成总结', category: 'analysis',
      description: '对指定内容生成结构化分析文档，包括背景、分析、结论和待办',
      input_schema: { type: 'object', properties: { content: { type: 'string', description: '需要总结的聊天内容' }, instructions: { type: 'string', description: '额外要求(可选)' } }, required: ['content'] },
      output_schema: { narrative: '', viewpoints: [], consensus: '', open_questions: [] } }
  ];

  for (const skill of defaultSkills) {
    createSkill(skill);
  }

  } // end if (!hasRules)

  // 添加初始场景（独立初始化，不依赖规则是否已存在）
  const existingScenes = db.exec('SELECT COUNT(*) FROM scenes');
  if (existingScenes[0].values[0][0] === 0) {
    const defaultScenes = [
      { id: 'free_talk', name: '自由发言', icon: '💬', description: '默认模式，Agent自由参与对话',
        context_prompt: '当前处于自由发言模式。你可以自由参与任何讨论，被@时优先回应。保持对话自然流畅。',
        trigger_keywords: [], auto_activate: false },
      { id: 'brainstorm', name: '头脑风暴', icon: '🧠', description: '集思广益，不批判，鼓励发散思维',
        context_prompt: '当前处于头脑风暴模式。请自由提出想法和建议，不批判任何观点，鼓励发散思维。每个想法都值得展开讨论。最终目标是产出尽可能多的方案。',
        trigger_keywords: ['头脑风暴', 'brainstorm', '讨论方案', '出主意', '有什么想法'], auto_activate: true },
      { id: 'story_chain', name: '故事接龙', icon: '📖', description: 'Agent轮流接续故事',
        context_prompt: '当前处于故事接龙模式。请接着上一个人的内容继续创作，保持故事连贯性和趣味性。每次发言控制在3-5句话，给其他Agent留出接龙空间。',
        trigger_keywords: ['故事接龙', '讲故事', '接龙', '编故事'], auto_activate: true },
      { id: 'casual_chat', name: '闲聊模式', icon: '☕', description: '轻松闲聊，不要求深度分析',
        context_prompt: '当前处于闲聊模式。放松对话，不需要深度技术分析。保持轻松愉快的氛围，可以分享趣事、开玩笑。',
        trigger_keywords: ['闲聊', '聊天', '放松', '随便聊聊'], auto_activate: true },
      { id: 'deep_discussion', name: '深度讨论', icon: '🔬', description: '深度分析模式，要求详细论证',
        context_prompt: '当前处于深度讨论模式。每个观点需要详细论证，提供数据和逻辑支撑。质疑和反驳是受欢迎的，但要基于事实。目标是深入理解问题本质。',
        trigger_keywords: ['深度讨论', '深入分析', '认真讨论', '技术方案'], auto_activate: true }
    ];
    for (const scene of defaultScenes) {
      createScene(scene);
    }
    console.log('[DB] 已初始化默认场景');
  }

  console.log('[DB] 已初始化默认治理数据');
}

// ==================== 规则运行时状态 ====================

function getRuntimeState(key) {
  const result = db.exec(
    "SELECT state_value FROM rule_runtime_state WHERE state_key = ? AND (expires_at IS NULL OR expires_at > datetime('now'))",
    [key]
  );
  if (result.length === 0 || result[0].values.length === 0) return null;
  try {
    return JSON.parse(result[0].values[0][0]);
  } catch (e) {
    return result[0].values[0][0];
  }
}

function setRuntimeState(key, value, ttlSeconds = null) {
  const now = formatShanghaiTime(new Date());
  const expiresAt = ttlSeconds
    ? formatShanghaiTime(new Date(Date.now() + ttlSeconds * 1000))
    : null;
  db.run(
    `INSERT OR REPLACE INTO rule_runtime_state (state_key, state_value, expires_at, updated_at) VALUES (?, ?, ?, ?)`,
    [key, JSON.stringify(value), expiresAt, now]
  );
  save();
}

function deleteRuntimeState(key) {
  db.run('DELETE FROM rule_runtime_state WHERE state_key = ?', [key]);
  save();
}

function getAgentLocks(agentId) {
  const locks = {};
  const result = db.exec(
    "SELECT state_key, state_value FROM rule_runtime_state WHERE state_key LIKE ? AND (expires_at IS NULL OR expires_at > datetime('now'))",
    [`lock:${agentId}:%`]
  );
  if (result.length > 0) {
    result[0].values.forEach(row => {
      const lockType = row[0].replace(`lock:${agentId}:`, '');
      try {
        locks[lockType] = JSON.parse(row[1]);
      } catch (e) {
        locks[lockType] = row[1];
      }
    });
  }
  return locks;
}

function getAgentCooldowns(agentId) {
  const cooldowns = {};
  const result = db.exec(
    "SELECT state_key, state_value FROM rule_runtime_state WHERE state_key LIKE ? AND (expires_at IS NULL OR expires_at > datetime('now'))",
    [`cooldown:${agentId}:%`]
  );
  if (result.length > 0) {
    result[0].values.forEach(row => {
      const cdType = row[0].replace(`cooldown:${agentId}:`, '');
      try {
        cooldowns[cdType] = JSON.parse(row[1]);
      } catch (e) {
        cooldowns[cdType] = row[1];
      }
    });
  }
  return cooldowns;
}

function incrementRuleHitCount(ruleId) {
  const key = `hitcount:${ruleId}`;
  const current = getRuntimeState(key) || 0;
  setRuntimeState(key, current + 1);
}

function getRuleHitCounts() {
  const counts = {};
  const result = db.exec(
    "SELECT state_key, state_value FROM rule_runtime_state WHERE state_key LIKE 'hitcount:%'"
  );
  if (result.length > 0) {
    result[0].values.forEach(row => {
      const ruleId = row[0].replace('hitcount:', '');
      try { counts[ruleId] = JSON.parse(row[1]); } catch (e) { counts[ruleId] = row[1]; }
    });
  }
  return counts;
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
  searchMessages,
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
  getAllTopicSummaries,
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
  // 场景
  getAllScenes,
  getSceneById,
  getEnabledScenes,
  getActiveScene,
  createScene,
  updateScene,
  deleteScene,
  activateScene,
  deactivateScene,
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
  getSkillCallStats,
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
  initDefaultGovernanceData,
  // 规则运行时状态
  getRuntimeState,
  setRuntimeState,
  deleteRuntimeState,
  getAgentLocks,
  getAgentCooldowns,
  incrementRuleHitCount,
  getRuleHitCounts
};
