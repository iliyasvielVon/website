const express = require('express');
const router = express.Router();
const db = require('../db');
const { authUser, authGM } = require('../middleware/auth');

// GET /api/users/me — 获取自己资料
router.get('/me', authUser, (req, res) => {
  const u = db.prepare('SELECT id,username,nickname,avatar,avatar_status,role,created_at FROM users WHERE username=?').get(req.user.username);
  res.json(u);
});

// PUT /api/users/me — 修改昵称
router.put('/me', authUser, (req, res) => {
  const { nickname } = req.body;
  if (nickname !== undefined) {
    if (nickname.length > 20) return res.status(400).json({ error: '昵称最多20字' });
    db.prepare('UPDATE users SET nickname=? WHERE username=?').run(nickname.trim(), req.user.username);
  }
  res.json({ ok: true });
});

// POST /api/users/me/avatar — 提交头像审核
router.post('/me/avatar', authUser, (req, res) => {
  const { avatar_url } = req.body;
  if (!avatar_url) return res.status(400).json({ error: '缺少头像URL' });
  // 写入待审核表
  db.prepare('INSERT INTO pending_avatars (username,avatar_url) VALUES (?,?)').run(req.user.username, avatar_url);
  // 更新用户状态为 pending
  db.prepare('UPDATE users SET avatar_status=? WHERE username=?').run('pending', req.user.username);
  res.json({ ok: true, message: '头像已提交审核，GM审核通过后生效' });
});

// GET /api/users/pending-avatars — GM查看待审核头像
router.get('/pending-avatars', authGM, (req, res) => {
  const list = db.prepare('SELECT * FROM pending_avatars WHERE status=? ORDER BY created_at DESC').all('pending');
  res.json(list);
});

// POST /api/users/pending-avatars/:id/approve — GM审核通过
router.post('/pending-avatars/:id/approve', authGM, (req, res) => {
  const item = db.prepare('SELECT * FROM pending_avatars WHERE id=?').get(req.params.id);
  if (!item) return res.status(404).json({ error: '不存在' });
  db.prepare('UPDATE users SET avatar=?,avatar_status=? WHERE username=?').run(item.avatar_url, 'approved', item.username);
  db.prepare('UPDATE pending_avatars SET status=? WHERE id=?').run('approved', item.id);
  // 通知用户
  if (req.push) req.push(item.username, { type: 'avatar_approved', avatar: item.avatar_url });
  res.json({ ok: true });
});

// POST /api/users/pending-avatars/:id/reject — GM拒绝
router.post('/pending-avatars/:id/reject', authGM, (req, res) => {
  const item = db.prepare('SELECT * FROM pending_avatars WHERE id=?').get(req.params.id);
  if (!item) return res.status(404).json({ error: '不存在' });
  db.prepare('UPDATE users SET avatar_status=? WHERE username=?').run('rejected', item.username);
  db.prepare('UPDATE pending_avatars SET status=? WHERE id=?').run('rejected', item.id);
  if (req.push) req.push(item.username, { type: 'avatar_rejected' });
  res.json({ ok: true });
});

module.exports = router;
