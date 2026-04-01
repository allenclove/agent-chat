const express = require('express');
const router = express.Router();
const db = require('../database');
const adminAuth = require('../middleware/adminAuth');

// GET /api/settings - 获取系统设置
router.get('/', (req, res) => {
  const settings = db.getAllSettings();
  res.json({ success: true, settings });
});

// POST /api/settings - 更新系统设置 (需要管理员权限)
router.post('/', adminAuth, (req, res) => {
  const { settings } = req.body;
  if (!settings) {
    return res.status(400).json({ error: '缺少设置数据' });
  }

  db.updateSettings(settings);
  const updated = db.getAllSettings();
  res.json({ success: true, settings: updated });
});

module.exports = router;