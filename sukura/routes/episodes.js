const express = require('express');
const router = express.Router({ mergeParams: true });
const db = require('../db');

// GET /api/videos/:vid/episodes
router.get('/', (req, res) => {
  const list = db.prepare('SELECT * FROM video_episodes WHERE video_id=? ORDER BY ep_num ASC').all(req.params.vid);
  res.json(list);
});

module.exports = router;
