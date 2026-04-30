const express = require('express');
const router = express.Router();
const db = require('../db');
const { authGM } = require('../middleware/auth');

// GET /api/changelog — GM查看全部日志
router.get('/', authGM, (req, res) => {
  const logs = db.prepare('SELECT * FROM changelog ORDER BY created_at DESC LIMIT 200').all();
  res.json(logs);
});

module.exports = router;
