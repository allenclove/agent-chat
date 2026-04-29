const http = require('http');
const express = require('express');
const path = require('path');
const db = require('./src/server/database');
const { setupWebSocket } = require('./src/server/websocket');
const agentManager = require('./src/server/agent-manager');
const routes = require('./src/server/routes');

const PORT = process.env.PORT || 8080;

// 主启动函数
async function start() {
  // 初始化数据库
  await db.init();

  // 初始化默认治理数据（规则、技能等）
  db.initDefaultGovernanceData();

  // 清理过期会话
  db.cleanExpiredSessions();

  // 设置配置变更回调
  db.setConfigChangeCallback(() => {
    console.log('[Server] 配置已热更新');
    agentManager.notifySettingsChanged();
    agentManager.broadcastParticipantsUpdate();
  });

  // 创建 Express 应用
  const app = express();

  // 请求体解析
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // 静态文件服务
  app.use(express.static(path.join(__dirname, 'src/public')));

  // API 路由
  app.use('/api', routes);

  // 创建 HTTP 服务器
  const server = http.createServer(app);

  // 设置WebSocket
  setupWebSocket(server);

  // 启动服务器
  server.listen(PORT, () => {
    console.log(`
╔════════════════════════════════════════╗
║       多Agent群聊系统已启动             ║
╠════════════════════════════════════════╣
║  地址: http://localhost:${PORT}           ║
║  WebSocket: ws://localhost:${PORT}        ║
║  框架: Express (已迁移)                 ║
╚════════════════════════════════════════╝
    `);
  });
}

// 启动
start().catch(err => {
  console.error('启动失败:', err);
  process.exit(1);
});