const http = require('http');
const fs = require('fs');
const path = require('path');
const db = require('./src/server/database');
const chat = require('./src/server/chat');
const { setupWebSocket } = require('./src/server/websocket');
const agentManager = require('./src/server/agent-manager');

const PORT = process.env.PORT || 8080;

// 主启动函数
async function start() {
  // 初始化数据库（异步）
  await db.init();

  // 清理过期会话
  db.cleanExpiredSessions();

  // 设置配置变更回调 - 配置热生效时通知所有Agent
  db.setConfigChangeCallback(() => {
    console.log('[Server] 配置已热更新');
    agentManager.notifySettingsChanged();
    agentManager.broadcastParticipantsUpdate();
  });

  // 创建HTTP服务器
  const server = http.createServer((req, res) => {
    // 解析URL
    let filePath = req.url === '/' ? '/index.html' : req.url;
    filePath = path.join(__dirname, 'src/public', filePath);

    // 确定内容类型
    const ext = path.extname(filePath);
    const contentTypes = {
      '.html': 'text/html',
      '.css': 'text/css',
      '.js': 'application/javascript',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.svg': 'image/svg+xml'
    };
    const contentType = contentTypes[ext] || 'text/plain';

    // 读取文件
    fs.readFile(filePath, (err, data) => {
      if (err) {
        if (err.code === 'ENOENT') {
          res.writeHead(404);
          res.end('Not Found');
        } else {
          res.writeHead(500);
          res.end('Server Error');
        }
        return;
      }
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    });
  });

  // API路由 - 登录/注册
  const apiHandler = (req, res) => {
    if (req.url === '/api/login' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const { username } = JSON.parse(body);

          if (!username || !username.trim()) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: '用户名不能为空' }));
            return;
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

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            success: true,
            session_id: sessionId,
            user: {
              id: user.id,
              username: user.username,
              display_name: user.display_name,
              avatar_url: user.avatar_url
            }
          }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: '无效的请求数据' }));
        }
      });
      return true;
    }

    if (req.url === '/api/logout' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const { session_id } = JSON.parse(body);
          if (session_id) {
            db.deleteSession(session_id);
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: '无效的请求数据' }));
        }
      });
      return true;
    }

    if (req.url.startsWith('/api/me') && req.method === 'GET') {
      // 从查询参数获取session_id
      const url = new URL(req.url, `http://localhost:${PORT}`);
      const sessionId = url.searchParams.get('session_id');

      if (!sessionId) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '未登录' }));
        return true;
      }

      const session = db.findSessionById(sessionId);
      if (!session) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '会话已过期' }));
        return true;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        user: {
          id: session.user_id,
          username: session.username,
          display_name: session.display_name,
          avatar_url: session.avatar_url
        }
      }));
      return true;
    }

    // 获取Agent列表（用于调试面板）
    if (req.url === '/api/agents' && req.method === 'GET') {
      const agents = agentManager.getAgentStatus();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, agents }));
      return true;
    }

    // 获取系统设置
    if (req.url === '/api/settings' && req.method === 'GET') {
      const settings = db.getAllSettings();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, settings }));
      return true;
    }

    // 更新系统设置
    if (req.url === '/api/settings' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const { settings } = JSON.parse(body);
          if (!settings || typeof settings !== 'object') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: '无效的设置数据' }));
            return;
          }

          db.updateSettings(settings);
          console.log('[Settings] 系统设置已更新');

          // 通知所有Agent重新加载设置
          agentManager.notifySettingsChanged();

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: '无效的请求数据' }));
        }
      });
      return true;
    }

    // 获取消息统计（调试用）
    if (req.url === '/api/messages/stats' && req.method === 'GET') {
      const stats = db.getMessageStats();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, stats }));
      return true;
    }

    // 清空所有消息（调试用）
    if (req.url === '/api/messages/clear' && req.method === 'POST') {
      db.clearMessages();
      console.log('[API] 消息已清空');
      // 通知所有用户和Agent清空历史
      chat.broadcast('clear_history', {});
      agentManager.broadcastClearHistory();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, message: '所有消息已清空' }));
      return true;
    }

    // ==================== 话题相关 API ====================

    // 获取话题列表
    if (req.url === '/api/topics' && req.method === 'GET') {
      const url = new URL(req.url, `http://localhost:${PORT}`);
      const limit = parseInt(url.searchParams.get('limit')) || 50;
      const offset = parseInt(url.searchParams.get('offset')) || 0;

      const topics = db.getTopics(limit, offset);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, topics }));
      return true;
    }

    // 创建话题
    if (req.url === '/api/topics' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const { title, description, message_ids, created_by } = JSON.parse(body);

          if (!title || !title.trim()) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: '标题不能为空' }));
            return;
          }

          const topic = db.createTopic(title.trim(), description, created_by, message_ids);
          console.log(`[API] 创建话题: ${topic.title}`);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, topic }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: '创建失败: ' + e.message }));
        }
      });
      return true;
    }

    // 获取话题详情 / 更新话题 / 删除话题
    const topicDetailMatch = req.url.match(/^\/api\/topics\/([^/?]+)(\?.*)?$/);
    if (topicDetailMatch) {
      const topicId = topicDetailMatch[1];

      // 获取话题详情
      if (req.method === 'GET') {
        const topic = db.getTopicById(topicId);
        if (!topic) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: '话题不存在' }));
          return true;
        }

        const messages = db.getTopicMessages(topicId);
        const summary = db.getTopicSummary(topicId);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          success: true,
          topic: { ...topic, messages, summary }
        }));
        return true;
      }

      // 更新话题
      if (req.method === 'PUT') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
          try {
            const { title, description } = JSON.parse(body);
            db.updateTopic(topicId, title, description);
            console.log(`[API] 更新话题: ${topicId}`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ success: true }));
          } catch (e) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: '更新失败' }));
          }
        });
        return true;
      }

      // 删除话题
      if (req.method === 'DELETE') {
        db.deleteTopic(topicId);
        console.log(`[API] 删除话题: ${topicId}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
        return true;
      }
    }

    // 添加消息到话题
    const addMessagesMatch = req.url.match(/^\/api\/topics\/([^/]+)\/messages$/);
    if (addMessagesMatch && req.method === 'POST') {
      const topicId = addMessagesMatch[1];
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const { message_ids } = JSON.parse(body);
          const added = db.addMessagesToTopic(topicId, message_ids);
          console.log(`[API] 添加 ${added} 条消息到话题 ${topicId}`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, added }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: '添加失败' }));
        }
      });
      return true;
    }

    // 生成/保存总结
    const summaryMatch = req.url.match(/^\/api\/topics\/([^/]+)\/summary$/);
    if (summaryMatch && req.method === 'POST') {
      const topicId = summaryMatch[1];
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const { narrative, viewpoints, consensus, open_questions } = JSON.parse(body);

          if (!narrative) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: '总结内容不能为空' }));
            return;
          }

          const summary = db.saveTopicSummary(topicId, narrative, viewpoints, consensus, open_questions);
          console.log(`[API] 保存话题总结: ${topicId}`);

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, summary }));
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: '保存失败' }));
        }
      });
      return true;
    }

    // 导出话题
    const exportMatch = req.url.match(/^\/api\/topics\/([^/?]+)\/export(\?.*)?$/);
    if (exportMatch && req.method === 'GET') {
      const topicId = exportMatch[1];
      const url = new URL(req.url, `http://localhost:${PORT}`);
      const format = url.searchParams.get('format') || 'markdown';

      const topic = db.getTopicById(topicId);
      if (!topic) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '话题不存在' }));
        return true;
      }

      const messages = db.getTopicMessages(topicId);
      const summary = db.getTopicSummary(topicId);

      let content, filename, contentType;

      if (format === 'json') {
        content = JSON.stringify({ topic, messages, summary }, null, 2);
        filename = `topic-${topicId}.json`;
        contentType = 'application/json';
      } else {
        // Markdown 格式
        content = `# ${topic.title}\n\n`;
        if (topic.description) {
          content += `> ${topic.description}\n\n`;
        }
        content += `**创建时间**: ${topic.created_at}\n\n`;
        content += `---\n\n`;
        content += `## 聊天记录\n\n`;
        messages.forEach(msg => {
          const time = msg.original_created_at || '';
          content += `**${msg.sender_name}** (${msg.sender_type}) - ${time}:\n${msg.content}\n\n`;
        });
        if (summary) {
          content += `---\n\n`;
          content += `## 总结\n\n`;
          content += `${summary.narrative}\n\n`;
          if (summary.viewpoints && summary.viewpoints.length > 0) {
            content += `### 各方观点\n\n`;
            summary.viewpoints.forEach(v => {
              content += `- **${v.name}** (${v.type}): ${v.summary}\n`;
            });
          }
          if (summary.consensus) {
            content += `\n### 共识\n${summary.consensus}\n`;
          }
        }
        filename = `topic-${topicId}.md`;
        contentType = 'text/markdown';
      }

      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${filename}"`
      });
      res.end(content);
      return true;
    }

    return false;
  };

  // 包装服务器以处理API请求
  const originalListener = server.listeners('request')[0];
  server.removeAllListeners('request');
  server.on('request', (req, res) => {
    if (!apiHandler(req, res)) {
      originalListener(req, res);
    }
  });

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
╚════════════════════════════════════════╝
    `);
  });
}

// 启动
start().catch(err => {
  console.error('启动失败:', err);
  process.exit(1);
});
