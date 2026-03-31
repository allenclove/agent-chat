const express = require('express');
const router = express.Router();
const db = require('../database');

// POST /api/login - 登录/注册
router.post('/login', (req, res) => {
  const { username } = req.body;

  if (!username || !username.trim()) {
    return res.status(400).json({ error: '用户名不能为空' });
  }

  const trimmedUsername = username.trim();

  // 查找或创建用户
  let user = db.findUserByUsername(trimmedUsername);
  if (!user) {
    user = db.createUser(trimmedUsername, trimmedUsername);
    console.log(`[User] 新用户注册: ${trimmedUsername}`);
  } else {
    console.log(`[User] 用户登录: ${trimmedUsername}`);
  }

  // 创建会话
  const sessionId = db.createSession(user.id);

  res.json({
    success: true,
    session_id: sessionId,
    user: {
      id: user.id,
      username: user.username,
      display_name: user.display_name,
      avatar_url: user.avatar_url
    }
  });
});

// POST /api/logout - 登出
router.post('/logout', (req, res) => {
  const { session_id } = req.body;
  if (session_id) {
    db.deleteSession(session_id);
  }
  res.json({ success: true });
});

// GET /api/me - 获取当前用户
router.get('/me', (req, res) => {
  const sessionId = req.query.session_id || req.headers['x-session-id'];

  if (!sessionId) {
    return res.status(401).json({ error: '未登录' });
  }

  const session = db.findSessionById(sessionId);
  if (!session) {
    return res.status(401).json({ error: '会话已过期' });
  }

  const user = db.findUserById(session.user_id);
  if (!user) {
    return res.status(401).json({ error: '用户不存在' });
  }

  res.json({
    success: true,
    user: {
      id: user.id,
      username: user.username,
      display_name: user.display_name,
      avatar_url: user.avatar_url
    }
  });
});

module.exports = router;