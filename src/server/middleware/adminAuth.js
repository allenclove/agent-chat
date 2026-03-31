// 管理员认证中间件
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

function adminAuth(req, res, next) {
  // 如果没有设置 ADMIN_TOKEN，跳过验证（开发模式）
  if (!ADMIN_TOKEN) {
    return next();
  }

  const token = req.headers['x-admin-token'] || req.query.admin_token;

  if (token !== ADMIN_TOKEN) {
    return res.status(401).json({ error: '需要管理员权限' });
  }

  next();
}

module.exports = adminAuth;