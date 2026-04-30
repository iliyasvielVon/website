const express = require('express');
const router = express.Router();
const db = require('../db');
const { authGM } = require('../middleware/auth');
const { ensureCat } = require('./categories');

function fmtVideo(v, cats) {
  let platforms = [], seasons = [], authorPlatforms = [];
  try { platforms = JSON.parse(v.platforms||'[]'); } catch(e){}
  try { seasons = JSON.parse(v.seasons||'[]'); } catch(e){}
  try { authorPlatforms = JSON.parse(v.author_platforms||'[]'); } catch(e){}
  if (!cats) {
    cats = db.prepare('SELECT cat_key FROM video_categories WHERE video_id=?').all(v.id).map(r => r.cat_key);
  }
  // 读取多作者
  const authors = db.prepare('SELECT * FROM video_authors WHERE video_id=? ORDER BY sort_order').all(v.id)
    .map(a => ({
      id: a.id, name: a.author_name, role: a.author_role||'',
      avatar: a.author_avatar||'', avatarImg: a.author_avatar_img||'',
      color: a.author_color||'#fb7299', fans: a.author_fans||0,
      platforms: (() => { try { return JSON.parse(a.author_platforms||'[]'); } catch(e){ return []; } })(),
      sortOrder: a.sort_order,
    }));
  // 读取多平台
  const vplatforms = db.prepare('SELECT * FROM video_platforms WHERE video_id=? ORDER BY sort_order').all(v.id)
    .map(p => ({
      id: p.id, name: p.platform_name, link: p.link||'',
      plays: p.plays||0, isRepost: !!p.is_repost,
      repostAuthor: p.repost_author||'', repostAuthorLink: p.repost_author_link||'',
      lastSyncAt: p.last_sync_at||null, syncType: p.sync_type||'manual',
      sortOrder: p.sort_order,
    }));
  // 计算播放量
  const totalPlays = vplatforms.reduce((s, p) => s + (p.plays||0), 0);
  const originalPlays = vplatforms.filter(p => !p.isRepost).reduce((s, p) => s + (p.plays||0), 0);
  const repostPlays = vplatforms.filter(p => p.isRepost).reduce((s, p) => s + (p.plays||0), 0);
  // 兼容旧字段：取第一个原版平台作为主平台
  const mainPlat = vplatforms.find(p => !p.isRepost) || vplatforms[0];
  // 兼容旧的 author 字段（取第一个作者）
  const mainAuthor = authors[0] || { name: v.author_name, avatar: v.author_avatar, avatarImg: v.author_avatar_img||'', color: v.author_color, fans: v.author_fans, platforms: authorPlatforms };
  return {
    id: v.id, title: v.title, cat: v.cat, cats: cats, cover: v.cover, emoji: v.emoji,
    desc: v.desc, status: v.status||'ongoing',
    platforms, plays: totalPlays || v.plays, eps: v.eps,
    pubDate: v.pub_date, lastUpdate: v.last_update,
    seasons, notes: v.notes||'',
    // 兼容旧字段
    author: {
      name: mainAuthor.name, avatar: mainAuthor.avatar,
      avatarImg: mainAuthor.avatarImg||'',
      color: mainAuthor.color, fans: mainAuthor.fans,
      platforms: mainAuthor.platforms||authorPlatforms,
    },
    // 新字段
    authors,
    vplatforms,
    totalPlays, originalPlays, repostPlays,
    likes: v.likes||0, coins: v.coins||0, favorites: v.favorites||0,
    shares: v.shares||0, comments: v.comments||0, danmakus: v.danmakus||0,
    lastSyncAt: v.last_sync_at||null, lastSyncResult: v.last_sync_result||null,
    novel: {
      name: v.novel_name, link: v.novel_link,
      author: v.novel_author||'', chapters: v.novel_chapters||0,
      finished: !!v.novel_finished, lastUpdate: v.novel_last_update||''
    },
    authorRecommends: (() => { try { return JSON.parse(v.author_recommends||'[]'); } catch(e){ return []; } })(),
    createdAt: v.created_at, updatedAt: v.updated_at,
  };
}

// 辅助：保存多作者到 video_authors 表
function saveAuthors(videoId, authors) {
  db.prepare('DELETE FROM video_authors WHERE video_id=?').run(videoId);
  (authors || []).forEach((a, i) => {
    db.prepare(`INSERT INTO video_authors
      (video_id, author_name, author_role, author_avatar, author_avatar_img, author_color, author_fans, author_platforms, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      videoId, a.name||'', a.role||'', a.avatar||'', a.avatarImg||'',
      a.color||'#fb7299', a.fans||0, JSON.stringify(a.platforms||[]), i
    );
  });
}

// 辅助：保存多平台到 video_platforms 表 + 更新播放量汇总
function savePlatforms(videoId, vplatforms) {
  db.prepare('DELETE FROM video_platforms WHERE video_id=?').run(videoId);
  (vplatforms || []).forEach((p, i) => {
    db.prepare(`INSERT INTO video_platforms
      (video_id, platform_name, link, plays, is_repost, repost_author, repost_author_link, sync_type, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      videoId, p.name||'B站', p.link||'', p.plays||0,
      p.isRepost ? 1 : 0, p.repostAuthor||'', p.repostAuthorLink||'',
      p.syncType||'manual', i
    );
  });
  // 更新播放量汇总
  const total = (vplatforms||[]).reduce((s, p) => s + (p.plays||0), 0);
  const original = (vplatforms||[]).filter(p => !p.isRepost).reduce((s, p) => s + (p.plays||0), 0);
  const repost = (vplatforms||[]).filter(p => p.isRepost).reduce((s, p) => s + (p.plays||0), 0);
  db.prepare('UPDATE videos SET total_plays=?, original_plays=?, repost_plays=? WHERE id=?')
    .run(total, original, repost, videoId);
}

// GET /api/videos
router.get('/', (req, res) => {
  const { cat, q } = req.query;
  let sql = 'SELECT * FROM videos'; const params = []; const where = [];
  if (cat && cat!=='all') {
    where.push('id IN (SELECT video_id FROM video_categories WHERE cat_key=?)');
    params.push(cat);
  }
  if (q) { where.push('(title LIKE ? OR author_name LIKE ?)'); params.push(`%${q}%`,`%${q}%`); }
  if (where.length) sql += ' WHERE '+where.join(' AND ');
  sql += ' ORDER BY plays DESC';
  res.json(db.prepare(sql).all(...params).map(v => fmtVideo(v)));
});

// GET /api/videos/:id
router.get('/:id', (req, res) => {
  const v = db.prepare('SELECT * FROM videos WHERE id=?').get(req.params.id);
  if (!v) return res.status(404).json({ error: '作品不存在' });
  const cl = db.prepare('SELECT * FROM video_changelog WHERE video_id=? ORDER BY created_at DESC').all(v.id);
  res.json({ ...fmtVideo(v), changelog: cl });
});

// POST /api/videos
router.post('/', authGM, (req, res) => {
  const b = req.body;
  const hasCat = b.cat || (b.cats && b.cats.length);
  if (!b.title||!b.authorName||!b.reason)
    return res.status(400).json({ error: '请填写所有必填项（含修改原因）' });
  if (b.cat) ensureCat(b.cat, b.catLabel);
  const result = db.prepare(`
    INSERT INTO videos (title,cat,cover,emoji,desc,status,platforms,plays,eps,pub_date,last_update,
      seasons,notes,author_name,author_avatar,author_avatar_img,author_color,author_fans,author_platforms,
      novel_name,novel_link,novel_author,novel_chapters,novel_finished,novel_last_update,author_recommends,orig_link)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(b.title,b.cat,b.cover||'',b.emoji||'🎬',b.desc,b.status||'ongoing',
         JSON.stringify(b.platforms||[]),b.plays||0,b.eps||0,b.pubDate||'',b.lastUpdate||'',
         JSON.stringify(b.seasons||[]),b.notes||'',
         b.authorName,b.authorAvatar||b.authorName[0],b.authorAvatarImg||'',
         b.authorColor||'#fb7299',b.authorFans||0,JSON.stringify(b.authorPlatforms||[]),
         b.novelName,b.novelLink,b.novelAuthor||'',b.novelChapters||0,b.novelFinished?1:0,
         b.novelLastUpdate||'',JSON.stringify(b.authorRecommends||[]),
         (b.platforms&&b.platforms[0])?b.platforms[0].link:'');
  const vid = result.lastInsertRowid;
  // 保存多分类
  const catsList = b.cats && b.cats.length ? b.cats : (b.cat ? [b.cat] : []);
  catsList.forEach(c => {
    if (c) {
      ensureCat(c, b.catLabel);
      db.prepare('INSERT OR IGNORE INTO video_categories (video_id, cat_key) VALUES (?, ?)').run(vid, c);
    }
  });
  // 保存多作者
  if (b.authors && b.authors.length) {
    saveAuthors(vid, b.authors);
  } else {
    // 兼容旧格式：从单作者字段构建
    saveAuthors(vid, [{
      name: b.authorName, role: '主创', avatar: b.authorAvatar||b.authorName[0],
      avatarImg: b.authorAvatarImg||'', color: b.authorColor||'#fb7299',
      fans: b.authorFans||0, platforms: b.authorPlatforms||[]
    }]);
  }
  // 保存多平台
  if (b.vplatforms && b.vplatforms.length) {
    savePlatforms(vid, b.vplatforms);
  } else if (b.platforms && b.platforms.length) {
    // 兼容旧格式
    savePlatforms(vid, b.platforms.map(p => ({
      name: p.name||'B站', link: p.link||'', plays: b.plays||0,
      isRepost: false, repostAuthor: '', repostAuthorLink: '', syncType: 'manual'
    })));
  }
  db.prepare('INSERT INTO video_changelog (video_id,action_type,reason) VALUES (?,?,?)').run(vid,'新增',b.reason);
  db.prepare('INSERT INTO changelog (action_type,target,reason) VALUES (?,?,?)').run('新增作品',b.title,b.reason);
  res.json({ id: vid, message: '添加成功' });
});

// PUT /api/videos/:id
router.put('/:id', authGM, (req, res) => {
  const b = req.body;
  if (!b.reason) return res.status(400).json({ error: '必须填写修改原因' });
  const v = db.prepare('SELECT id FROM videos WHERE id=?').get(req.params.id);
  if (!v) return res.status(404).json({ error: '作品不存在' });
  db.prepare(`
    UPDATE videos SET title=?,cat=?,cover=?,emoji=?,desc=?,status=?,platforms=?,plays=?,eps=?,
      pub_date=?,last_update=?,seasons=?,notes=?,
      author_name=?,author_avatar=?,author_avatar_img=?,author_color=?,author_fans=?,author_platforms=?,
      novel_name=?,novel_link=?,novel_author=?,novel_chapters=?,novel_finished=?,novel_last_update=?,
      author_recommends=?,updated_at=datetime('now','localtime')
    WHERE id=?
  `).run(b.title,b.cat,b.cover||'',b.emoji||'🎬',b.desc,b.status||'ongoing',
         JSON.stringify(b.platforms||[]),b.plays||0,b.eps||0,b.pubDate||'',b.lastUpdate||'',
         JSON.stringify(b.seasons||[]),b.notes||'',
         b.authorName,b.authorAvatar||b.authorName[0],b.authorAvatarImg||'',
         b.authorColor||'#fb7299',b.authorFans||0,JSON.stringify(b.authorPlatforms||[]),
         b.novelName,b.novelLink,b.novelAuthor||'',b.novelChapters||0,b.novelFinished?1:0,
         b.novelLastUpdate||'',JSON.stringify(b.authorRecommends||[]),req.params.id);
  // 更新多分类：删旧的，加新的
  db.prepare('DELETE FROM video_categories WHERE video_id=?').run(req.params.id);
  const catsList = b.cats && b.cats.length ? b.cats : (b.cat ? [b.cat] : []);
  catsList.forEach(c => {
    if (c) {
      ensureCat(c, b.catLabel);
      db.prepare('INSERT OR IGNORE INTO video_categories (video_id, cat_key) VALUES (?, ?)').run(req.params.id, c);
    }
  });
  // 更新多作者
  if (b.authors && b.authors.length) {
    saveAuthors(req.params.id, b.authors);
  } else {
    saveAuthors(req.params.id, [{
      name: b.authorName, role: '主创', avatar: b.authorAvatar||b.authorName[0],
      avatarImg: b.authorAvatarImg||'', color: b.authorColor||'#fb7299',
      fans: b.authorFans||0, platforms: b.authorPlatforms||[]
    }]);
  }
  // 更新多平台
  if (b.vplatforms && b.vplatforms.length) {
    savePlatforms(req.params.id, b.vplatforms);
  } else if (b.platforms && b.platforms.length) {
    savePlatforms(req.params.id, b.platforms.map(p => ({
      name: p.name||'B站', link: p.link||'', plays: b.plays||0,
      isRepost: false, repostAuthor: '', repostAuthorLink: '', syncType: 'manual'
    })));
  }
  db.prepare('INSERT INTO video_changelog (video_id,action_type,reason) VALUES (?,?,?)').run(req.params.id,'更新',b.reason);
  db.prepare('INSERT INTO changelog (action_type,target,reason) VALUES (?,?,?)').run('更新作品',b.title,b.reason);
  res.json({ message: '更新成功' });
});

// DELETE /api/videos/:id
router.delete('/:id', authGM, (req, res) => {
  const { reason } = req.body;
  if (!reason) return res.status(400).json({ error: '必须填写移除原因' });
  const v = db.prepare('SELECT * FROM videos WHERE id=?').get(req.params.id);
  if (!v) return res.status(404).json({ error: '作品不存在' });
  db.prepare('DELETE FROM video_authors WHERE video_id=?').run(req.params.id);
  db.prepare('DELETE FROM video_platforms WHERE video_id=?').run(req.params.id);
  db.prepare('DELETE FROM videos WHERE id=?').run(req.params.id);
  db.prepare('INSERT INTO changelog (action_type,target,reason) VALUES (?,?,?)').run('移除作品',v.title,reason);
  res.json({ message: '已移除' });
});

module.exports = router;
