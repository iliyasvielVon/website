const express = require('express');
const router = express.Router({ mergeParams: true });
const db = require('../db');
const { authGM } = require('../middleware/auth');

// GET /api/videos/:vid/music
router.get('/', (req, res) => {
  const list = db.prepare('SELECT * FROM video_music WHERE video_id=? ORDER BY sort ASC,id ASC').all(req.params.vid);
  res.json(list);
});

// POST /api/videos/:vid/music
router.post('/', authGM, (req, res) => {
  const { title, artist, cover, source_link, eps_used, plays, likes, favorites, coins, comments, shares, sort } = req.body;
  if (!title) return res.status(400).json({ error: '歌曲名必填' });
  const r = db.prepare(
    'INSERT INTO video_music (video_id,title,artist,cover,source_link,eps_used,plays,likes,favorites,coins,comments,shares,sort) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)'
  ).run(req.params.vid, title, artist||'', cover||'', source_link||'', eps_used||'', plays||0, likes||0, favorites||0, coins||0, comments||0, shares||0, sort||0);
  res.json({ id: r.lastInsertRowid });
});

// PUT /api/videos/:vid/music/:id
router.put('/:id', authGM, (req, res) => {
  const { title, artist, cover, source_link, eps_used, plays, likes, favorites, coins, comments, shares, sort } = req.body;
  if (!title) return res.status(400).json({ error: '歌曲名必填' });
  db.prepare(
    'UPDATE video_music SET title=?,artist=?,cover=?,source_link=?,eps_used=?,plays=?,likes=?,favorites=?,coins=?,comments=?,shares=?,sort=? WHERE id=? AND video_id=?'
  ).run(title, artist||'', cover||'', source_link||'', eps_used||'', plays||0, likes||0, favorites||0, coins||0, comments||0, shares||0, sort||0, req.params.id, req.params.vid);
  res.json({ ok: true });
});

// DELETE /api/videos/:vid/music/:id
router.delete('/:id', authGM, (req, res) => {
  db.prepare('DELETE FROM video_music WHERE id=? AND video_id=?').run(req.params.id, req.params.vid);
  res.json({ ok: true });
});

module.exports = router;
