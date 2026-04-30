const express = require('express');
const router = express.Router();
const db = require('../db');
const { authGM } = require('../middleware/auth');

// GET /api/categories — 公开，用户端读取
router.get('/', (req, res) => {
  const cats = db.prepare('SELECT * FROM categories ORDER BY sort ASC, id ASC').all();
  res.json(cats);
});

// POST /api/categories — GM新增
router.post('/', authGM, (req, res) => {
  const { key, label, sort } = req.body;
  if (!key || !label) return res.status(400).json({ error: '分类key和名称必填' });
  if (!/^[a-z0-9_]+$/.test(key)) return res.status(400).json({ error: 'key只能含小写字母、数字、下划线' });
  try {
    const r = db.prepare('INSERT INTO categories (key,label,sort) VALUES (?,?,?)').run(key, label, sort||0);
    res.json({ id: r.lastInsertRowid });
  } catch(e) {
    res.status(400).json({ error: '分类key已存在' });
  }
});

// PUT /api/categories/:id — GM修改
router.put('/:id', authGM, (req, res) => {
  const { label, sort } = req.body;
  if (!label) return res.status(400).json({ error: '名称必填' });
  db.prepare('UPDATE categories SET label=?,sort=? WHERE id=?').run(label, sort||0, req.params.id);
  res.json({ ok: true });
});

// DELETE /api/categories/:id — GM删除
router.delete('/:id', authGM, (req, res) => {
  db.prepare('DELETE FROM categories WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// 内部使用：确保分类存在，不存在则自动创建
function ensureCat(key, label) {
  const exists = db.prepare('SELECT id FROM categories WHERE key=?').get(key);
  if (!exists) {
    const maxSort = db.prepare('SELECT MAX(sort) as m FROM categories').get();
    db.prepare('INSERT INTO categories (key,label,sort) VALUES (?,?,?)').run(key, label||key, (maxSort.m||0)+1);
  }
}
module.exports = router;
module.exports.ensureCat = ensureCat;
