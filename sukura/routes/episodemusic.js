const express = require('express');
const router = express.Router({ mergeParams: true });
const db = require('../db');
const { authGM } = require('../middleware/auth');

// GET /api/videos/:vid/episodes/:epnum/music
router.get('/', (req, res) => {
  const list = db.prepare('SELECT * FROM episode_music WHERE video_id=? AND ep_num=? ORDER BY timestamp ASC, sort ASC').all(req.params.vid, req.params.epnum);
  res.json(list);
});

// POST /api/videos/:vid/episodes/:epnum/music
router.post('/', authGM, (req, res) => {
  const { music_id, title, artist, source_link, video_link, timestamp, sort } = req.body;
  if (!title) return res.status(400).json({ error: '需要音乐名称' });
  const result = db.prepare('INSERT INTO episode_music (video_id,ep_num,music_id,title,artist,source_link,video_link,timestamp,sort) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(req.params.vid, req.params.epnum, music_id||null, title, artist||'', source_link||'', video_link||'', timestamp||0, sort||0);
  res.json({ id: result.lastInsertRowid });
});

// PUT /api/videos/:vid/episodes/:epnum/music/:id
router.put('/:id', authGM, (req, res) => {
  const { music_id, title, artist, source_link, video_link, timestamp, sort } = req.body;
  db.prepare('UPDATE episode_music SET music_id=?,title=?,artist=?,source_link=?,video_link=?,timestamp=?,sort=? WHERE id=?')
    .run(music_id||null, title, artist||'', source_link||'', video_link||'', timestamp||0, sort||0, req.params.id);
  res.json({ message: 'ok' });
});

// DELETE /api/videos/:vid/episodes/:epnum/music/:id
router.delete('/:id', authGM, (req, res) => {
  db.prepare('DELETE FROM episode_music WHERE id=?').run(req.params.id);
  res.json({ message: 'ok' });
});

module.exports = router;
