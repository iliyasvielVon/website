const express = require('express');
const router = express.Router();
const db = require('../db');
const { authGM } = require('../middleware/auth');

// 公开接口 - 获取播放列表
router.get('/', (req, res) => {
  const list = db.prepare('SELECT * FROM music ORDER BY sort ASC, id ASC').all();
  res.json(list);
});

// GM - 添加音乐
router.post('/', authGM, (req, res) => {
  const { title, artist, cover, url, lyrics, lyrics_type, sort, source_link } = req.body;
  if (!title || !url) return res.status(400).json({ error: '标题和音乐URL必填' });
  const r = db.prepare(
    'INSERT INTO music (title,artist,cover,url,lyrics,lyrics_type,sort,source_link) VALUES (?,?,?,?,?,?,?,?)'
  ).run(title, artist||'', cover||'', url, lyrics||'', lyrics_type||'lrc', sort||0, source_link||'');
  res.json({ id: r.lastInsertRowid });
});

// GM - 更新
router.put('/:id', authGM, (req, res) => {
  const { title, artist, cover, url, lyrics, lyrics_type, sort, source_link } = req.body;
  if (!title || !url) return res.status(400).json({ error: '标题和音乐URL必填' });
  db.prepare(
    'UPDATE music SET title=?,artist=?,cover=?,url=?,lyrics=?,lyrics_type=?,sort=?,source_link=? WHERE id=?'
  ).run(title, artist||'', cover||'', url, lyrics||'', lyrics_type||'lrc', sort||0, source_link||'', req.params.id);
  res.json({ ok: true });
});

// GM - 删除
router.delete('/:id', authGM, (req, res) => {
  db.prepare('DELETE FROM music WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
