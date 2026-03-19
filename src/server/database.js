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
      websocket_url TEXT NOT NULL,
      message_filter TEXT DEFAULT 'all',
      keywords TEXT,
      history_limit INTEGER DEFAULT 50,
      enabled INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 从配置文件加载Agent
  loadAgentsFromConfig();

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
  db.run(
    'INSERT INTO messages (sender_id, sender_name, sender_type, content) VALUES (?, ?, ?, ?)',
    [senderId, senderName, senderType, content]
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
    created_at: new Date().toISOString()
  };
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
      `UPDATE agent_configs SET name = ?, avatar_url = ?, websocket_url = ?, message_filter = ?, keywords = ?, history_limit = ?, enabled = 1 WHERE id = ?`,
      [
        config.name,
        config.avatar_url || null,
        config.websocket_url,
        config.message_filter || 'all',
        config.keywords ? JSON.stringify(config.keywords) : null,
        config.history_limit || 50,
        config.id
      ]
    );
  } else {
    // 插入新配置
    db.run(
      `INSERT INTO agent_configs (id, name, avatar_url, websocket_url, message_filter, keywords, history_limit, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        config.id,
        config.name,
        config.avatar_url || null,
        config.websocket_url,
        config.message_filter || 'all',
        config.keywords ? JSON.stringify(config.keywords) : null,
        config.history_limit || 50
      ]
    );
  }
  save();
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

module.exports = {
  init,
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
  // Agent
  getAllAgents,
  getAgentById,
  addAgent,
  loadAgentsFromConfig
};
