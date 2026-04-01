const express = require('express');
const router = express.Router();

// 子路由
const authRoutes = require('./auth');
const adminRoutes = require('./admin');
const platformRoutes = require('./platform');
const settingsRoutes = require('./settings');
const messagesRoutes = require('./messages');
const topicsRoutes = require('./topics');
const agentsRoutes = require('./agents');
const debugRoutes = require('./debug');

router.use('/', authRoutes);
router.use('/admin', adminRoutes);
router.use('/platform', platformRoutes);
router.use('/settings', settingsRoutes);
router.use('/messages', messagesRoutes);
router.use('/topics', topicsRoutes);
router.use('/agents', agentsRoutes);
router.use('/debug', debugRoutes);

module.exports = router;