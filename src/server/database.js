const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const dbPath = path.join(__dirname, '../../data/chat.db');
let db = null;

// 初始化数据库
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
  if (result.length === 0 || result[0].values.length === 0) return null;

  const columns = result[0].columns;
  const values = result[0].values[0];
  const user = {};
  columns.forEach((col, i) => user[col] = values[i]);
  return user;
}

function findUserById(id) {
  const result = db.exec('SELECT * FROM users WHERE id = ?', [id]);
  if (result.length === 0 || result[0].values.length === 0) return null;

  const columns = result[0].columns;
  const values = result[0].values[0];
  const user = {};
  columns.forEach((col, i) => user[col] = values[i]);
  return user;
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

  if (result.length === 0 || result[0].values.length === 0) return null;

  const columns = result[0].columns;
  const values = result[0].values[0];
  const session = {};
  columns.forEach((col, i) => session[col] = values[i]);
  return session;
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

  return {
    id,
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

  const columns = result[0].columns;
  const messages = result[0].values.reverse().map(values => {
    const msg = {};
    columns.forEach((col, i) => msg[col] = values[i]);
    return msg;
  });

  return messages;
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
  if (result.length === 0) return [];

  const columns = result[0].columns;
  return result[0].values.map(values => {
    const agent = {};
    columns.forEach((col, i) => agent[col] = values[i]);
    return agent;
  });
}

function getAgentById(id) {
  const result = db.exec('SELECT * FROM agent_configs WHERE id = ?', [id]);
  if (result.length === 0 || result[0].values.length === 0) return null;

  const columns = result[0].columns;
  const values = result[0].values[0];
  const agent = {};
  columns.forEach((col, i) => agent[col] = values[i]);
  return agent;
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
  if (result.length === 0 || result[0].values.length === 0) return null;

  const columns = result[0].columns;
  const values = result[0].values[0];
  const agent = {};
  columns.forEach((col, i) => agent[col] = values[i]);
  return agent;
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
  save();

  console.log(`[DB] Agent ${agentId} 设置已更新:`, Object.keys(settings).join(', '));
  return getAgentById(agentId);
}

// 获取 Agent 完整配置（包括解析后的 JSON 字段）
function getAgentFullConfig(agentId) {
  const agent = getAgentById(agentId);
  if (!agent) return null;

  // 解析 JSON 字段
  try {
    if (agent.keywords) agent.keywords = JSON.parse(agent.keywords);
  } catch (e) {
    agent.keywords = [];
  }
  try {
    if (agent.custom_settings) agent.custom_settings = JSON.parse(agent.custom_settings);
  } catch (e) {
    agent.custom_settings = {};
  }

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

    if (result.length === 0) return [];

    const columns = result[0].columns;
    const topics = result[0].values.map(values => {
      const topic = {};
      columns.forEach((col, i) => topic[col] = values[i]);
      return topic;
    });

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

  if (result.length === 0 || result[0].values.length === 0) return null;

  const columns = result[0].columns;
  const values = result[0].values[0];
  const topic = {};
  columns.forEach((col, i) => topic[col] = values[i]);

  return topic;
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

  if (result.length === 0) return [];

  const columns = result[0].columns;
  return result[0].values.map(values => {
    const msg = {};
    columns.forEach((col, i) => msg[col] = values[i]);
    return msg;
  });
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

  if (result.length === 0 || result[0].values.length === 0) return null;

  const columns = result[0].columns;
  const values = result[0].values[0];
  const summary = {};
  columns.forEach((col, i) => {
    if (col === 'viewpoints' || col === 'open_questions') {
      try {
        summary[col] = JSON.parse(values[i]);
      } catch (e) {
        summary[col] = values[i];
      }
    } else {
      summary[col] = values[i];
    }
  });

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

  if (result.length === 0) return [];

  const columns = result[0].columns;
  return result[0].values.map(values => {
    const msg = {};
    columns.forEach((col, i) => msg[col] = values[i]);
    return msg;
  });
}

module.exports = {
  init,
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
  getTopicSummary
};
