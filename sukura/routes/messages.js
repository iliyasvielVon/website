const express = require('express');
const router = express.Router();
const db = require('../db');
const { authUser, authGM } = require('../middleware/auth');

// ─── 用户侧 ───────────────────────────────────────────────

router.post('/', authUser, (req, res) => {
  const { type, content } = req.body;
  if (!type || !content) return res.status(400).json({ error: '请填写完整' });
  const result = db.prepare('INSERT INTO messages (from_user,type,content,user_read) VALUES (?,?,?,1)').run(req.user.username, type, content);
  const msgId = result.lastInsertRowid;
  db.prepare('INSERT INTO message_replies (message_id,sender,role,content,is_read) VALUES (?,?,?,?,1)').run(msgId, req.user.username, 'user', content);
  if (req.pushGM) req.pushGM({ type:'new_message', from: req.user.username, topic_id: msgId });
  res.json({ id: msgId, message: '提交成功，GM会尽快处理' });
});

router.get('/mine', authUser, (req, res) => {
  const topics = db.prepare('SELECT * FROM messages WHERE from_user=? ORDER BY created_at DESC').all(req.user.username);
  const result = topics.map(t => {
    const replies = db.prepare('SELECT mr.*,u.nickname,u.avatar FROM message_replies mr LEFT JOIN users u ON u.username=mr.sender WHERE mr.message_id=? ORDER BY mr.created_at ASC').all(t.id);
    const unread = replies.filter(r => r.role==='gm' && !r.is_read).length;
    return { ...t, replies, unread };
  });
  res.json(result);
});

router.get('/mine/unread', authUser, (req, res) => {
  const r = db.prepare(`SELECT COUNT(*) as c FROM message_replies mr JOIN messages m ON m.id=mr.message_id WHERE m.from_user=? AND mr.role='gm' AND mr.is_read=0`).get(req.user.username);
  res.json({ count: r.c });
});

router.post('/mine/read-all', authUser, (req, res) => {
  db.prepare(`UPDATE message_replies SET is_read=1 WHERE role='gm' AND message_id IN (SELECT id FROM messages WHERE from_user=?)`).run(req.user.username);
  db.prepare('UPDATE messages SET user_read=1 WHERE from_user=?').run(req.user.username);
  res.json({ ok: true });
});

// ─── GM侧（固定路径必须在 /:id 前面）────────────────────

router.get('/unread-count', authGM, (req, res) => {
  const r = db.prepare('SELECT COUNT(*) as c FROM messages WHERE is_read=0').get();
  res.json({ count: r.c });
});

router.get('/', authGM, (req, res) => {
  const topics = db.prepare('SELECT * FROM messages ORDER BY created_at DESC').all();
  const result = topics.map(t => {
    const replies = db.prepare('SELECT mr.*,u.nickname,u.avatar FROM message_replies mr LEFT JOIN users u ON u.username=mr.sender WHERE mr.message_id=? ORDER BY mr.created_at ASC').all(t.id);
    const unread = replies.filter(r => r.role==='user' && !r.is_read).length;
    return { ...t, replies, unread };
  });
  db.prepare('UPDATE messages SET is_read=1 WHERE is_read=0').run();
  res.json(result);
});

router.post('/:id/reply', authGM, (req, res) => {
  const { content, image_url } = req.body;
  if (!content && !image_url) return res.status(400).json({ error: '回复内容不能为空' });
  const msg = db.prepare('SELECT id,from_user FROM messages WHERE id=?').get(req.params.id);
  if (!msg) return res.status(404).json({ error: '话题不存在' });
  db.prepare('INSERT INTO message_replies (message_id,sender,role,content,image_url,is_read) VALUES (?,?,?,?,?,0)').run(req.params.id, 'gm', 'gm', content||'', image_url||null);
  db.prepare('UPDATE messages SET user_read=0 WHERE id=?').run(req.params.id);
  db.prepare("UPDATE messages SET reply=?,reply_time=datetime('now','localtime') WHERE id=?").run(content||'[图片]', req.params.id);
  if (req.push) req.push(msg.from_user, { type:'gm_reply', topic_id: Number(req.params.id) });
  res.json({ ok: true });
});

// ─── 通用（带参数路由放最后）────────────────────────────

router.post('/:id/read', authUser, (req, res) => {
  const msg = db.prepare('SELECT id FROM messages WHERE id=? AND from_user=?').get(req.params.id, req.user.username);
  if (!msg) return res.status(404).json({ error: '不存在' });
  db.prepare('UPDATE message_replies SET is_read=1 WHERE message_id=? AND role=?').run(req.params.id, 'gm');
  db.prepare('UPDATE messages SET user_read=1 WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

router.post('/:id/reply-user', authUser, (req, res) => {
  const { content, image_url } = req.body;
  if (!content && !image_url) return res.status(400).json({ error: '内容不能为空' });
  const msg = db.prepare('SELECT id FROM messages WHERE id=? AND from_user=?').get(req.params.id, req.user.username);
  if (!msg) return res.status(403).json({ error: '无权限' });
  db.prepare('INSERT INTO message_replies (message_id,sender,role,content,image_url,is_read) VALUES (?,?,?,?,?,0)').run(req.params.id, req.user.username, 'user', content||'', image_url||null);
  db.prepare('UPDATE messages SET is_read=0 WHERE id=?').run(req.params.id);
  if (req.pushGM) req.pushGM({ type:'new_reply', from: req.user.username, topic_id: Number(req.params.id) });
  res.json({ ok: true });
});

router.get('/:id', (req, res) => {
  const auth = req.headers.authorization;
  let caller = null;
  if (auth && auth.startsWith('Bearer ')) {
    try { const {JWT_SECRET}=require('../config'); caller=require('jsonwebtoken').verify(auth.slice(7),JWT_SECRET); } catch(e){}
  }
  if (!caller) return res.status(401).json({ error: '未登录' });
  const msg = db.prepare('SELECT * FROM messages WHERE id=?').get(req.params.id);
  if (!msg) return res.status(404).json({ error: '不存在' });
  if (caller.role!=='gm' && msg.from_user!==caller.username) return res.status(403).json({ error: '无权限' });
  const replies = db.prepare('SELECT mr.*,u.nickname,u.avatar FROM message_replies mr LEFT JOIN users u ON u.username=mr.sender WHERE mr.message_id=? ORDER BY mr.created_at ASC').all(req.params.id);
  res.json({ ...msg, replies });
});

module.exports = router;
