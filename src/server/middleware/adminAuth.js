// 管理员认证中间件
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const isProduction = process.env.NODE_ENV === 'production';

function adminAuth(req, res, next) {
  // 生产环境必须设置 ADMIN_TOKEN
  if (!ADMIN_TOKEN) {
    if (isProduction) {
      console.error('[Security] 生产环境必须设置 ADMIN_TOKEN 环境变量');
      return res.status(500).json({ error: '服务器配置错误' });
    }
    // 开发模式：未设置 ADMIN_TOKEN 时警告但仍允许访问
    console.warn('[Security] 警告：未设置 ADMIN_TOKEN，管理员 API 未受保护');
    return next();
  }

  const token = req.headers['x-admin-token'] || req.query.admin_token;

  if (token !== ADMIN_TOKEN) {
    return res.status(401).json({ error: '需要管理员权限' });
  }

  next();
}

module.exports = adminAuth;