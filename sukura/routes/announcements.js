const express = require('express');
const router = express.Router();
const db = require('../db');
const { authGM } = require('../middleware/auth');

// GET /api/announcements - 公开，返回启用的公告
router.get('/', (req, res) => {
  const list = db.prepare('SELECT id, content, link FROM announcements WHERE enabled=1 ORDER BY sort_order').all();
  res.json(list);
});

// GET /api/announcements/all - GM，返回所有
router.get('/all', authGM, (req, res) => {
  const list = db.prepare('SELECT * FROM announcements ORDER BY sort_order, id').all();
  res.json(list);
});

// POST /api/announcements - GM 新增
router.post('/', authGM, (req, res) => {
  const { content, link, enabled, sort_order } = req.body;
  if (!content) return res.status(400).json({ error: '内容必填' });
  const result = db.prepare(`INSERT INTO announcements (content, link, enabled, sort_order) VALUES (?, ?, ?, ?)`)
    .run(content, link||'', enabled===false?0:1, sort_order||0);
  res.json({ id: result.lastInsertRowid });
});

// PUT /api/announcements/:id - GM 更新
router.put('/:id', authGM, (req, res) => {
  const { content, link, enabled, sort_order } = req.body;
  if (!content) return res.status(400).json({ error: '内容必填' });
  db.prepare(`UPDATE announcements SET content=?, link=?, enabled=?, sort_order=?, updated_at=datetime('now','localtime') WHERE id=?`)
    .run(content, link||'', enabled?1:0, sort_order||0, req.params.id);
  res.json({ ok: true });
});

// DELETE /api/announcements/:id - GM 删除
router.delete('/:id', authGM, (req, res) => {
  db.prepare('DELETE FROM announcements WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
