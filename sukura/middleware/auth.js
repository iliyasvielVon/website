const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config');

function authUser(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: '未登录' });
  try {
    req.user = jwt.verify(auth.slice(7), JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token 无效或已过期，请重新登录' });
  }
}

function authGM(req, res, next) {
  authUser(req, res, () => {
    if (req.user.role !== 'gm') return res.status(403).json({ error: '无权限' });
    next();
  });
}

module.exports = { authUser, authGM };
