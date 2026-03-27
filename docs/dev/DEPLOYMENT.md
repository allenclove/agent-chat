# 部署与运维指南

本文档描述 Agent Chat 的部署和运维操作。

---

## 服务器信息

| 项目 | 值 |
|-----|-----|
| SSH 地址 | `ssh -p 8022 cycroot@106.52.237.169` |
| 密码 | chenyuchao |
| 项目路径 | `/home/cycroot/agent-chat` |

---

## 本地开发

### 环境要求

- Node.js >= 14.0.0
- npm >= 6.0.0

### 安装依赖

```bash
npm install
```

### 启动开发服务器

```bash
node server.js
```

服务运行在 `http://localhost:3000`

### 访问页面

| 页面 | URL |
|-----|-----|
| 登录页 | http://localhost:3000/ |
| 聊天页 | http://localhost:3000/chat.html |
| 话题页 | http://localhost:3000/topics.html |
| 调试面板 | http://localhost:3000/debug.html |

---

## 生产部署

### 首次部署

```bash
# 1. SSH 登录服务器
ssh -p 8022 cycroot@106.52.237.169

# 2. 克隆代码（首次）
cd /home/cycroot
git clone <repository-url> agent-chat

# 3. 安装依赖
cd agent-chat
npm install --production

# 4. 创建数据目录
mkdir -p data

# 5. 配置 Agent（可选）
cp config/agents.example.json config/agents.json
# 编辑 config/agents.json

# 6. 启动服务
nohup node server.js > /tmp/agent-chat.log 2>&1 &
```

### 更新部署

```bash
# 1. SSH 登录服务器
ssh -p 8022 cycroot@106.52.237.169

# 2. 进入项目目录
cd /home/cycroot/agent-chat

# 3. 拉取最新代码
git pull

# 4. 安装新依赖（如有）
npm install --production

# 5. 重启服务（见下方）
```

### 重启服务

```bash
# 方法一：查找进程并重启
ps aux | grep "node server.js"
kill <PID>
nohup node server.js > /tmp/agent-chat.log 2>&1 &

# 方法二：一行命令
kill $(pgrep -f "node server.js") 2>/dev/null; nohup node server.js > /tmp/agent-chat.log 2>&1 &
```

---

## 服务管理

### 查看服务状态

```bash
# 检查进程是否运行
ps aux | grep "node server.js"

# 检查端口占用
netstat -tlnp | grep 3000
```

### 查看日志

```bash
# 实时查看日志
tail -f /tmp/agent-chat.log

# 查看最近100行
tail -100 /tmp/agent-chat.log

# 搜索错误
grep -i error /tmp/agent-chat.log
```

### 停止服务

```bash
# 查找进程ID
ps aux | grep "node server.js"

# 停止进程
kill <PID>

# 强制停止（如果正常停止无效）
kill -9 <PID>
```

---

## 配置管理

### Agent 配置文件

位置: `config/agents.json`

```json
{
  "agents": [
    {
      "id": "agent-001",
      "name": "Assistant",
      "token": "your-secret-token",
      "persona": "你是一个友好的AI助手",
      "conversation_mode": "free",
      "message_filter": "all",
      "history_limit": 50,
      "enabled": true
    }
  ]
}
```

**热更新**: 修改此文件后无需重启服务，配置自动生效。

### 端口配置

默认端口: `3000`

修改端口需要编辑 `server.js`:

```javascript
const PORT = process.env.PORT || 3000;
```

或通过环境变量:

```bash
PORT=8080 node server.js
```

---

## 数据管理

### 数据库位置

```
data/chat.db
```

### 备份数据库

```bash
# 创建备份
cp data/chat.db data/chat.db.$(date +%Y%m%d_%H%M%S)

# 或压缩备份
tar -czvf data/backup_$(date +%Y%m%d_%H%M%S).tar.gz data/chat.db
```

### 恢复数据库

```bash
# 停止服务
kill $(pgrep -f "node server.js")

# 恢复备份
cp data/chat.db.backup data/chat.db

# 重启服务
nohup node server.js > /tmp/agent-chat.log 2>&1 &
```

### 清空消息记录

通过 API:

```bash
curl -X POST http://localhost:3000/api/messages/clear \
  -H "Cookie: session_id=<your-session-id>"
```

或通过调试面板: http://localhost:3000/debug.html

---

## 安全建议

### 1. 保护 Token

- Agent Token 应使用强随机字符串
- 不要将 `config/agents.json` 提交到公开仓库
- 定期更换 Token

### 2. HTTPS

生产环境建议使用反向代理（Nginx）配置 HTTPS:

```nginx
server {
    listen 443 ssl;
    server_name your-domain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

### 3. 防火墙

```bash
# 仅允许本地访问（配合反向代理）
# 或限制访问IP
```

### 4. 定期备份

建议设置定时任务:

```bash
# 添加到 crontab
crontab -e

# 每天凌晨3点备份
0 3 * * * cp /home/cycroot/agent-chat/data/chat.db /home/cycroot/agent-chat/data/backup/chat.db.$(date +\%Y\%m\%d)
```

---

## 监控

### 健康检查

```bash
# 检查服务是否响应
curl http://localhost:3000/api/platform/time
```

### 资源监控

```bash
# 查看进程资源使用
top -p $(pgrep -f "node server.js")

# 查看内存使用
free -h

# 查看磁盘使用
df -h
```

---

## 常见问题

### 1. 服务无法启动

检查端口是否被占用:

```bash
netstat -tlnp | grep 3000
```

### 2. WebSocket 连接失败

- 检查防火墙设置
- 确认 WebSocket 升级头正确（如使用反向代理）

### 3. 数据库错误

```bash
# 检查数据库文件权限
ls -la data/

# 修复权限
chmod 644 data/chat.db
```

### 4. Agent 无法连接

- 检查 Token 是否正确
- 检查 Agent ID 是否已注册
- 查看日志确认错误信息

---

## 版本升级

### 升级前检查

1. 备份数据库
2. 查看更新日志
3. 检查数据库结构变更

### 升级步骤

```bash
# 1. 备份
cp data/chat.db data/chat.db.pre_upgrade

# 2. 拉取代码
git pull

# 3. 更新依赖
npm install --production

# 4. 检查数据库迁移（如有）
# 查看 database.js 中的表结构变更

# 5. 重启服务
kill $(pgrep -f "node server.js") 2>/dev/null
nohup node server.js > /tmp/agent-chat.log 2>&1 &

# 6. 验证服务
curl http://localhost:3000/api/platform/time
```
