const express = require('express');
const router = express.Router();
const db = require('../db');

// 智能去重：按天数自动切换粒度
function smartGroup(rows) {
  if (!rows.length) return [];
  // 先按天去重
  const dayMap = {};
  rows.forEach(r => {
    const day = r.sync_at.slice(0, 10);
    dayMap[day] = { ...r, sync_at: day };
  });
  const days = Object.values(dayMap).sort((a,b) => a.sync_at.localeCompare(b.sync_at));

  // 不超过31条直接返回
  if (days.length <= 31) return days;

  // 超过31，按月分组
  const monthMap = {};
  days.forEach(r => {
    const month = r.sync_at.slice(0, 7); // YYYY-MM
    monthMap[month] = { ...r, sync_at: month };
  });
  const months = Object.values(monthMap).sort((a,b) => a.sync_at.localeCompare(b.sync_at));
  if (months.length <= 12) return months;

  // 超过12个月，按年分组
  const yearMap = {};
  months.forEach(r => {
    const year = r.sync_at.slice(0, 4);
    yearMap[year] = { ...r, sync_at: year };
  });
  const years = Object.values(yearMap).sort((a,b) => a.sync_at.localeCompare(b.sync_at));
  // 100年上限（取最近100年）
  return years.slice(-100);
}

router.get('/video/:id', (req, res) => {
  const list = db.prepare('SELECT * FROM video_stats_history WHERE video_id=? ORDER BY sync_at ASC').all(req.params.id);
  res.json(smartGroup(list));
});

router.get('/episode/:vid/:epnum', (req, res) => {
  const list = db.prepare('SELECT * FROM episode_stats_history WHERE video_id=? AND ep_num=? ORDER BY sync_at ASC').all(req.params.vid, req.params.epnum);
  res.json(smartGroup(list));
});

router.get('/author/:name', (req, res) => {
  const list = db.prepare('SELECT * FROM author_stats_history WHERE author_name=? ORDER BY sync_at ASC').all(decodeURIComponent(req.params.name));
  res.json(smartGroup(list));
});

module.exports = router;
