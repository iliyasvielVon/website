const express = require('express');
const router = express.Router();
const https = require('https');
const http = require('http');
const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');
const db = require('../db');
const { authGM } = require('../middleware/auth');
const uploadsDir = path.join(__dirname, '..', 'public', 'uploads');

function bget(p) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, val) => { if (settled) return; settled = true; fn(val); };

    const req = https.get({
      hostname: 'api.bilibili.com', path: p,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://space.bilibili.com/'
      }
    }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { finish(resolve, JSON.parse(d)); }
        catch(e) { finish(reject, new Error('解析失败')); }
      });
      res.on('error', e => finish(reject, e));
    });
    req.on('error', e => finish(reject, e));
    req.setTimeout(10000, () => { req.destroy(); finish(reject, new Error('socket 超时')); });

    // 总超时 30 秒：不管 socket 状态如何，超过就放弃
    setTimeout(() => {
      if (!settled) {
        try { req.destroy(); } catch(e) {}
        finish(reject, new Error('请求超时（总时长）'));
      }
    }, 30000);
  });
}

// 下载图片到本地，本地已有则直接返回
function downloadImg(url, prefix, existingLocalPath) {
  return new Promise((resolve) => {
    if (!url) return resolve(null);
    // 本地已有且文件存在，直接复用
    if (existingLocalPath && existingLocalPath.startsWith('/uploads/')) {
      const fullPath = path.join(__dirname, '..', 'public', existingLocalPath);
      if (fs.existsSync(fullPath)) return resolve(existingLocalPath);
    }
    // 下载新的
    try {
      const client = url.startsWith('https') ? https : http;
      const ext = (url.match(/\.(jpg|jpeg|png|gif|webp)/i) || ['.jpg'])[0];
      const filename = prefix + '_' + Date.now() + ext;
      const filepath = path.join(uploadsDir, filename);
      const file = fs.createWriteStream(filepath);
      const req = client.get(url, {
        headers: {
          'Referer': 'https://www.bilibili.com',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      }, res => {
        res.pipe(file);
        file.on('finish', () => {
          file.close(() => {
            // 下载完成后压缩：宽度限制720px，质量75
            try {
              execSync(`convert "${filepath}" -resize '720x>' -quality 75 -strip "${filepath}.tmp" && mv "${filepath}.tmp" "${filepath}"`, { stdio: 'ignore' });
            } catch(e) {}
            resolve('/uploads/' + filename);
          });
        });
      });
      req.on('error', () => { try { fs.unlinkSync(filepath); } catch(e){} resolve(null); });
      req.setTimeout(15000, () => { req.destroy(); resolve(null); });
      // 总超时 30 秒：图片下载最多 30 秒，超过就放弃
      setTimeout(() => {
        try { req.destroy(); } catch(e) {}
        try { file.close(); } catch(e) {}
        try { fs.unlinkSync(filepath); } catch(e) {}
        resolve(null);
      }, 30000);
    } catch(e) { resolve(null); }
  });
}

function extractBvid(url) {
  const m = url.match(/BV[a-zA-Z0-9]+/);
  return m ? m[0] : null;
}

// 快速同步：只更新合集总播放量和粉丝数，不逐集请求
async function syncVideoQuick(video) {
  const platforms = JSON.parse(video.platforms || '[]');
  const biliPlat = platforms.find(p => p.link && p.link.includes('bilibili'));
  if (!biliPlat) return { id: video.id, title: video.title, skipped: true, reason: '非B站视频' };
  const bvid = extractBvid(biliPlat.link);
  if (!bvid) return { id: video.id, title: video.title, skipped: true, reason: '无法提取bvid' };

  try {
    const v = await bget('/x/web-interface/view?bvid=' + bvid);
    if (v.code !== 0) return { id: video.id, title: video.title, skipped: true, reason: 'B站返回: ' + v.message };

    const mid = v.data.owner?.mid;
    const ownerName = v.data.owner?.name || '';
    const updates = {};

    // 合集分页汇总播放量（快速，不逐集）
    const season = v.data.ugc_season;
    if (season && mid) {
      const epCount = season.ep_count || 0;
      const pages = Math.ceil(epCount / 30);
      let totalView = 0, totalDanmaku = 0, latestPubdate = 0;
      for (let p = 1; p <= pages; p++) {
        try {
          const col = await bget('/x/polymer/web-space/seasons_archives_list?mid=' + mid + '&season_id=' + season.id + '&page_num=' + p + '&page_size=30');
          (col.data?.archives || []).forEach(a => {
            totalView += a.stat?.view || 0;
            totalDanmaku += a.stat?.danmaku || 0;
            if (a.pubdate > latestPubdate) latestPubdate = a.pubdate;
          });
          await new Promise(r => setTimeout(r, 2000));
        } catch(e) {}
      }
      // 兜底：如果合集 API 没拿到数据（totalView=0），用 video_episodes 表已有数据，避免清零
      if (totalView === 0) {
        const fallback = db.prepare('SELECT SUM(views) as v, SUM(danmaku) as d FROM video_episodes WHERE video_id=?').get(video.id);
        if (fallback && fallback.v > 0) {
          totalView = fallback.v;
          totalDanmaku = fallback.d || 0;
          console.log('[SYNC] id=' + video.id + ' 合集API失败，用 video_episodes 兜底：plays=' + totalView);
        }
      }
      updates.plays = totalView;
      updates.eps = epCount;
      updates.danmakus = totalDanmaku;
      if (latestPubdate) updates.last_update = new Date(latestPubdate*1000).toISOString().slice(0,10);
    } else {
      updates.plays = v.data.stat?.view || 0;
      updates.danmakus = v.data.stat?.danmaku || 0;
      if (v.data.pubdate) updates.last_update = new Date(v.data.pubdate*1000).toISOString().slice(0,10);
    }

    // 粉丝数
    let newFans = null;
    if (mid) {
      try {
        const s = await bget('/x/relation/stat?vmid=' + mid);
        if (s.data?.follower) newFans = s.data.follower;
      } catch(e) {}
      if (newFans !== null) {
        db.prepare('UPDATE videos SET author_fans=? WHERE author_name=?').run(newFans, video.author_name);
      }
    }

    // 写入
    Object.keys(updates).forEach(k => { if (updates[k] === undefined) delete updates[k]; });
    const setFields = Object.keys(updates).map(k => k+'=?').join(',');
    if (setFields) {
      db.prepare(`UPDATE videos SET ${setFields},updated_at=datetime('now','localtime') WHERE id=?`)
        .run(...Object.values(updates), video.id);
    }

    const syncResult = '快速同步 播放:'+(updates.plays||0)+' 粉丝:'+(newFans||0);
    db.prepare("UPDATE videos SET last_sync_at=datetime('now','localtime'),last_sync_result=? WHERE id=?").run(syncResult, video.id);

    // 记录视频快照
    db.prepare(`INSERT INTO video_stats_history (video_id,plays,likes,coins,favorites,shares,comments,danmakus) VALUES (?,?,?,?,?,?,?,?)`)
      .run(video.id, updates.plays||0, 0, 0, 0, 0, 0, updates.danmakus||0);

    // 记录作者快照
    if (newFans !== null) {
      const totals = db.prepare(`SELECT SUM(plays) as p, SUM(likes) as l, SUM(coins) as c, SUM(favorites) as f, SUM(shares) as s, SUM(comments) as cm, SUM(danmakus) as d FROM videos WHERE author_name=?`).get(video.author_name);
      db.prepare(`INSERT INTO author_stats_history (author_name,fans,total_plays,total_likes,total_coins,total_favorites,total_shares,total_comments,total_danmakus) VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(video.author_name, newFans, totals.p||0, totals.l||0, totals.c||0, totals.f||0, totals.s||0, totals.cm||0, totals.d||0);
    }

    return { id: video.id, title: video.title, ok: true, updates: { ...updates, author_fans: newFans } };
  } catch(e) {
    return { id: video.id, title: video.title, skipped: true, reason: e.message };
  }
}

async function syncVideo(video, jobId = null) {
  // 进度更新辅助函数
  const updateJob = (fields) => {
    if (!jobId) return;
    try {
      const keys = Object.keys(fields);
      const sql = 'UPDATE sync_jobs SET ' + keys.map(k => k+'=?').join(',') + ' WHERE id=?';
      db.prepare(sql).run(...keys.map(k => fields[k]), jobId);
    } catch(e) {}
  };

  const platforms = JSON.parse(video.platforms || '[]');
  const biliPlat = platforms.find(p => p.link && p.link.includes('bilibili'));
  if (!biliPlat) return { id: video.id, title: video.title, skipped: true, reason: '非B站视频' };

  const bvid = extractBvid(biliPlat.link);
  if (!bvid) return { id: video.id, title: video.title, skipped: true, reason: '无法提取bvid' };

  try {
    const v = await bget('/x/web-interface/view?bvid=' + bvid);
    if (v.code !== 0) return { id: video.id, title: video.title, skipped: true, reason: 'B站返回: ' + v.message };

    const stat = v.data.stat;
    const mid = v.data.owner?.mid;
    const ownerName = v.data.owner?.name || '';
    const ownerFace = v.data.owner?.face || '';
    const updates = {};

    // 合集信息
    const season = v.data.ugc_season;
    if (season && mid) {
      const epCount = season.ep_count || 0;
      const pages = Math.ceil(epCount / 30);
      let allBvids = [], totalView = 0, totalDanmaku = 0, latestPubdate = 0;

      for (let p = 1; p <= pages; p++) {
        try {
          const col = await bget('/x/polymer/web-space/seasons_archives_list?mid=' + mid + '&season_id=' + season.id + '&page_num=' + p + '&page_size=30');
          const archives = col.data?.archives || [];
          archives.forEach(a => {
            totalView += a.stat?.view || 0;
            totalDanmaku += a.stat?.danmaku || 0;
            if (a.pubdate > latestPubdate) latestPubdate = a.pubdate;
            allBvids.push(a.bvid);
          });
          await new Promise(r => setTimeout(r, 2000 + Math.floor(Math.random() * 2000)));
        } catch(e) {}
      }

      // 逐集获取完整stat并下载封面
      let totalLike=0, totalCoin=0, totalFav=0, totalShare=0, totalReply=0;
      // 删除前先缓存现有分集封面（按 ep_num 索引）
      const existingCovers = {};
      const existingEpsRows = db.prepare('SELECT ep_num, cover FROM video_episodes WHERE video_id=?').all(video.id);
      for (const r of existingEpsRows) existingCovers[r.ep_num] = r.cover;
      db.prepare('DELETE FROM video_episodes WHERE video_id=?').run(video.id);
      const insertEp = db.prepare('INSERT INTO video_episodes (video_id,ep_num,bvid,title,cover,duration,pubdate,views,danmaku,likes,coins,favorites,shares,comments) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)');

      // 设置总集数
      updateJob({ total_eps: allBvids.length });

      for (let ei = 0; ei < allBvids.length; ei++) {
        const epBvid = allBvids[ei];
        try {
          const vstat = await bget('/x/web-interface/view?bvid=' + epBvid);
          if (vstat.code === 0) {
            const s = vstat.data.stat;
            const d = vstat.data;
            totalLike  += s.like     || 0;
            totalCoin  += s.coin     || 0;
            totalFav   += s.favorite || 0;
            totalShare += s.share    || 0;
            totalReply += s.reply    || 0;
            // 下载分集封面（本地有则复用）
            const existingCover = existingCovers[ei+1];
            let epCover = d.pic || '';
            if (epCover && epCover.startsWith('http')) {
              const local = await downloadImg(epCover, 'ep_'+video.id+'_'+(ei+1), existingCover);
              // 下载失败时保留旧封面（只要旧文件还存在）
              if (local) epCover = local;
              else if (existingCover) {
                const fullPath = path.join(__dirname, '..', 'public', existingCover);
                if (fs.existsSync(fullPath)) epCover = existingCover;
              }
            }
            const pubdate = d.pubdate ? new Date(d.pubdate*1000).toISOString().slice(0,10) : '';
            insertEp.run(video.id, ei+1, epBvid, d.title||'', epCover, d.duration||0, pubdate,
              s.view||0, s.danmaku||0, s.like||0, s.coin||0, s.favorite||0, s.share||0, s.reply||0);
            // 更新进度
            updateJob({ done_eps: ei+1, current_ep_title: d.title||'' });
          }
        } catch(e) {}
        await new Promise(r => setTimeout(r, 2000 + Math.floor(Math.random() * 2000)));
      }

      updates.plays     = totalView;
      updates.eps       = epCount;
      updates.likes     = totalLike;
      updates.coins     = totalCoin;
      updates.favorites = totalFav;
      updates.shares    = totalShare;
      updates.comments  = totalReply;
      updates.danmakus  = totalDanmaku;
      // 没封面或封面是B站URL都重新下载
      if ((!video.cover || !video.cover.startsWith('/uploads/')) && season.cover) {
        const localCover = await downloadImg(season.cover, 'cover_'+video.id, video.cover);
        if (localCover) updates.cover = localCover;
      }
      if (latestPubdate) updates.last_update = new Date(latestPubdate*1000).toISOString().slice(0,10);
    } else {
      updates.plays     = stat.view     || 0;
      updates.likes     = stat.like     || 0;
      updates.coins     = stat.coin     || 0;
      updates.favorites = stat.favorite || 0;
      updates.shares    = stat.share    || 0;
      updates.comments  = stat.reply    || 0;
      updates.danmakus  = stat.danmaku  || 0;
      if (v.data.videos) updates.eps = v.data.videos;
      if (v.data.pubdate) updates.last_update = new Date(v.data.pubdate*1000).toISOString().slice(0,10);
    }

    // 过滤undefined
    Object.keys(updates).forEach(k => { if (updates[k] === undefined) delete updates[k]; });
    const setFields = Object.keys(updates).map(k => k+'=?').join(',');
    const setVals = Object.values(updates);
    if (setFields) {
      db.prepare(`UPDATE videos SET ${setFields},updated_at=datetime('now','localtime') WHERE id=?`)
        .run(...setVals, video.id);
    }

    // 粉丝数
    let newFans = null;
    if (mid) {
      try {
        const s = await bget('/x/relation/stat?vmid=' + mid);
        if (s.data?.follower) newFans = s.data.follower;
      } catch(e) {}
      if (newFans !== null) {
        db.prepare('UPDATE videos SET author_fans=? WHERE author_name=?').run(newFans, video.author_name);
        // 更新平台粉丝数
        const allByAuthor = db.prepare('SELECT id,author_platforms FROM videos WHERE author_name=?').all(video.author_name);
        for (const av of allByAuthor) {
          try {
            const plats = JSON.parse(av.author_platforms || '[]');
            const biliAP = plats.find(p => p.link && p.link.includes('bilibili'));
            if (biliAP) {
              biliAP.fans = newFans;
              db.prepare('UPDATE videos SET author_platforms=? WHERE id=?').run(JSON.stringify(plats), av.id);
            }
          } catch(e) {}
        }
      }
    }

    // 下载头像（本地有则复用）
    if (ownerFace) {
      const existingAvatar = db.prepare('SELECT author_avatar_img FROM videos WHERE author_name=? LIMIT 1').get(video.author_name)?.author_avatar_img;
      const localAvatar = await downloadImg(ownerFace, 'avatar_'+ownerName.replace(/[^a-zA-Z0-9]/g,''), existingAvatar);
      if (localAvatar) {
        db.prepare('UPDATE videos SET author_avatar_img=? WHERE author_name=?').run(localAvatar, video.author_name);
      }
    }

    // UP主改名
    if (ownerName && ownerName !== video.author_name) {
      db.prepare('UPDATE videos SET author_name=?,author_avatar=? WHERE id=?').run(ownerName, ownerName[0], video.id);
      db.prepare('UPDATE videos SET author_name=? WHERE author_name=?').run(ownerName, video.author_name);
    }

    // 记录同步时间
    const syncResult = '播放:'+(updates.plays||0)+' 粉丝:'+(newFans||0)+' 集数:'+(updates.eps||0);
    db.prepare("UPDATE videos SET last_sync_at=datetime('now','localtime'),last_sync_result=? WHERE id=?").run(syncResult, video.id);

    // 记录视频整体快照
    db.prepare(`INSERT INTO video_stats_history (video_id,plays,likes,coins,favorites,shares,comments,danmakus) VALUES (?,?,?,?,?,?,?,?)`)
      .run(video.id, updates.plays||0, updates.likes||0, updates.coins||0, updates.favorites||0, updates.shares||0, updates.comments||0, updates.danmakus||0);

    // 记录分集快照
    if (season && mid) {
      const eps = db.prepare('SELECT * FROM video_episodes WHERE video_id=?').all(video.id);
      const insertEpHist = db.prepare(`INSERT INTO episode_stats_history (video_id,ep_num,bvid,views,likes,coins,favorites,shares,comments,danmaku) VALUES (?,?,?,?,?,?,?,?,?,?)`);
      for (const ep of eps) {
        insertEpHist.run(ep.video_id, ep.ep_num, ep.bvid, ep.views, ep.likes, ep.coins, ep.favorites, ep.shares, ep.comments, ep.danmaku);
      }
    }

    // 记录作者快照（汇总该作者所有作品）
    if (newFans !== null) {
      const totals = db.prepare(`SELECT 
        SUM(plays) as p, SUM(likes) as l, SUM(coins) as c, SUM(favorites) as f,
        SUM(shares) as s, SUM(comments) as cm, SUM(danmakus) as d
        FROM videos WHERE author_name=?`).get(video.author_name);
      db.prepare(`INSERT INTO author_stats_history (author_name,fans,total_plays,total_likes,total_coins,total_favorites,total_shares,total_comments,total_danmakus) VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(video.author_name, newFans, totals.p||0, totals.l||0, totals.c||0, totals.f||0, totals.s||0, totals.cm||0, totals.d||0);
    }

    return {
      id: video.id, title: video.title, ok: true,
      updates: { ...updates, author_fans: newFans }
    };
  } catch(e) {
    return { id: video.id, title: video.title, skipped: true, reason: e.message };
  }
}

// POST /api/sync/quick/all — 快速同步全部
router.post('/quick/all', authGM, async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  const send = (data) => res.write('data: ' + JSON.stringify(data) + '\n\n');
  const videos = db.prepare('SELECT * FROM videos').all();
  send({ type: 'start', total: videos.length });
  const results = [];
  for (let i = 0; i < videos.length; i++) {
    const v = videos[i];
    send({ type: 'progress', current: i+1, total: videos.length, title: v.title });
    const r = await syncVideoQuick(v);
    results.push(r);
    send({ type: 'result', result: r });
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  const ok = results.filter(r => r.ok).length;
  db.prepare('INSERT INTO changelog (action_type,target,reason) VALUES (?,?,?)').run(
    '快速同步', '全部视频', `快速同步完成：${ok}个成功`
  );
  send({ type: 'done', ok, skipped: results.filter(r=>r.skipped).length, results });
  res.end();
});

// POST /api/sync/video/:id - 异步：立即返回 jobId，后台跑
router.post('/video/:id', authGM, async (req, res) => {
  const v = db.prepare('SELECT * FROM videos WHERE id=?').get(req.params.id);
  if (!v) return res.status(404).json({ error: '视频不存在' });

  // 检查是否已经在同步中
  const existing = db.prepare("SELECT id FROM sync_jobs WHERE video_id=? AND status='running'").get(req.params.id);
  if (existing) {
    return res.status(409).json({ error: '该视频正在同步中', jobId: existing.id });
  }

  // 创建任务
  const result = db.prepare(`INSERT INTO sync_jobs (video_id, type, status, started_at) VALUES (?, ?, 'running', datetime('now','localtime'))`)
    .run(v.id, 'full');
  const jobId = result.lastInsertRowid;

  // 立即返回 jobId
  res.json({ ok: true, jobId, message: '同步已开始（后台运行）' });

  // 后台异步执行
  (async () => {
    try {
      const result = await syncVideo(v, jobId);
      db.prepare(`UPDATE sync_jobs SET status=?, finished_at=datetime('now','localtime'), result_json=?, error_msg=? WHERE id=?`)
        .run(result.ok ? 'done' : 'failed', JSON.stringify(result), result.reason || '', jobId);
    } catch(e) {
      db.prepare(`UPDATE sync_jobs SET status='failed', finished_at=datetime('now','localtime'), error_msg=? WHERE id=?`)
        .run(e.message, jobId);
    }
  })();
});

// GET /api/sync/jobs/active - 所有正在跑的任务
router.get('/jobs/active', authGM, (req, res) => {
  const jobs = db.prepare(`
    SELECT sj.*, v.title, v.cover
    FROM sync_jobs sj
    LEFT JOIN videos v ON v.id = sj.video_id
    WHERE sj.status='running'
    ORDER BY sj.started_at DESC
  `).all();
  res.json(jobs);
});

// GET /api/sync/jobs - 所有任务（含历史，最近 50 条）
router.get('/jobs', authGM, (req, res) => {
  const jobs = db.prepare(`
    SELECT sj.*, v.title, v.cover
    FROM sync_jobs sj
    LEFT JOIN videos v ON v.id = sj.video_id
    ORDER BY sj.started_at DESC
    LIMIT 50
  `).all();
  res.json(jobs);
});

// GET /api/sync/jobs/:id - 单个任务详情（前端轮询用）
router.get('/jobs/:id', authGM, (req, res) => {
  const job = db.prepare(`
    SELECT sj.*, v.title, v.cover
    FROM sync_jobs sj
    LEFT JOIN videos v ON v.id = sj.video_id
    WHERE sj.id=?
  `).get(req.params.id);
  if (!job) return res.status(404).json({ error: '任务不存在' });
  res.json(job);
});

// POST /api/sync/zero-plays-async — 同步播放量为 0 的视频（快速同步）
router.post('/zero-plays-async', authGM, (req, res) => {
  const existingPending = db.prepare("SELECT COUNT(*) as c FROM sync_jobs WHERE status IN ('pending','running')").get().c;
  if (existingPending > 0) {
    return res.status(409).json({ error: `已有 ${existingPending} 个任务在队列中，请等待完成` });
  }
  // 找需要补全的视频：1) 播放量为 0  2) 没有分集数据  3) eps 字段与实际分集数不一致
  const videos = db.prepare(`
    SELECT v.* FROM videos v
    WHERE v.plays IS NULL OR v.plays = 0
       OR NOT EXISTS (SELECT 1 FROM video_episodes WHERE video_id=v.id)
       OR v.eps != (SELECT COUNT(*) FROM video_episodes WHERE video_id=v.id)
  `).all();
  if (videos.length === 0) {
    return res.json({ ok: true, total: 0, message: '所有视频数据均已完整' });
  }
  const insert = db.prepare(`INSERT INTO sync_jobs (video_id, type, status, started_at) VALUES (?, 'full', 'pending', datetime('now','localtime'))`);
  const tx = db.transaction(() => { for (const v of videos) insert.run(v.id); });
  tx();
  res.json({ ok: true, total: videos.length, message: `已创建 ${videos.length} 个完整同步任务（零播放视频）` });
  processPendingJobs();
});

// POST /api/sync/quick/all-async — 异步快速同步全部
router.post('/quick/all-async', authGM, (req, res) => {
  const existingPending = db.prepare("SELECT COUNT(*) as c FROM sync_jobs WHERE status IN ('pending','running')").get().c;
  if (existingPending > 0) {
    return res.status(409).json({ error: `已有 ${existingPending} 个任务在队列中，请等待完成` });
  }
  const videos = db.prepare('SELECT * FROM videos').all();
  const insert = db.prepare(`INSERT INTO sync_jobs (video_id, type, status, started_at) VALUES (?, 'quick', 'pending', datetime('now','localtime'))`);
  const tx = db.transaction(() => { for (const v of videos) insert.run(v.id); });
  tx();
  res.json({ ok: true, total: videos.length, message: `已创建 ${videos.length} 个快速同步任务` });
  processPendingJobs();
});

// POST /api/sync/author-async — 异步按作者同步
router.post('/author-async', authGM, (req, res) => {
  const { videoIds } = req.body;
  if (!Array.isArray(videoIds) || videoIds.length === 0) {
    return res.status(400).json({ error: '请提供 videoIds 数组' });
  }
  const existingPending = db.prepare("SELECT COUNT(*) as c FROM sync_jobs WHERE status IN ('pending','running')").get().c;
  if (existingPending > 0) {
    return res.status(409).json({ error: `已有 ${existingPending} 个任务在队列中，请等待完成` });
  }
  const insert = db.prepare(`INSERT INTO sync_jobs (video_id, type, status, started_at) VALUES (?, 'author', 'pending', datetime('now','localtime'))`);
  const tx = db.transaction(() => { for (const id of videoIds) insert.run(id); });
  tx();
  res.json({ ok: true, total: videoIds.length, message: `已创建 ${videoIds.length} 个同步任务` });
  processPendingJobs();
});

// POST /api/sync/all-async — 异步全部同步（持久化任务）
router.post('/all-async', authGM, (req, res) => {
  // 检查是否已有 pending/running 的全部同步
  const existingPending = db.prepare("SELECT COUNT(*) as c FROM sync_jobs WHERE status IN ('pending','running')").get().c;
  if (existingPending > 0) {
    return res.status(409).json({ error: `已有 ${existingPending} 个任务在队列中，请等待完成` });
  }

  const videos = db.prepare('SELECT * FROM videos').all();
  // 创建 pending 任务
  const insert = db.prepare(`INSERT INTO sync_jobs (video_id, type, status, started_at) VALUES (?, 'full', 'pending', datetime('now','localtime'))`);
  const tx = db.transaction(() => {
    for (const v of videos) insert.run(v.id);
  });
  tx();

  res.json({ ok: true, total: videos.length, message: `已创建 ${videos.length} 个同步任务` });

  // 后台串行处理 pending 任务
  processPendingJobs();
});

// 后台串行处理 pending 任务
let _isProcessing = false;
async function processPendingJobs() {
  if (_isProcessing) return;
  _isProcessing = true;
  try {
    while (true) {
      // 注意：必须给 sync_jobs.id 起别名，否则会被 videos.id 覆盖
      const job = db.prepare(`
        SELECT sj.id AS job_id, sj.video_id AS sj_video_id, sj.type AS job_type,
               v.*
        FROM sync_jobs sj LEFT JOIN videos v ON v.id=sj.video_id
        WHERE sj.status='pending' ORDER BY sj.id LIMIT 1
      `).get();
      if (!job) break;
      const jobId = job.job_id;  // 真正的 sync_jobs.id
      // 标记 running
      db.prepare("UPDATE sync_jobs SET status='running' WHERE id=?").run(jobId);
      try {
        const result = job.job_type === 'quick'
          ? await syncVideoQuick(job)
          : await syncVideo(job, jobId);
        db.prepare(`UPDATE sync_jobs SET status=?, finished_at=datetime('now','localtime'), result_json=?, error_msg=? WHERE id=?`)
          .run(result.ok ? 'done' : 'failed', JSON.stringify(result), result.reason || '', jobId);
      } catch(e) {
        db.prepare(`UPDATE sync_jobs SET status='failed', finished_at=datetime('now','localtime'), error_msg=? WHERE id=?`)
          .run(e.message, jobId);
      }
      await new Promise(r => setTimeout(r, 500));
    }
  } finally {
    _isProcessing = false;
  }
}

// 服务器启动时清理残留 running（避免重启后状态卡住），自动恢复 pending
setTimeout(() => {
  // 把残留 running 标 failed（重启已经中断了）
  const stuckCount = db.prepare("SELECT COUNT(*) as c FROM sync_jobs WHERE status='running'").get().c;
  if (stuckCount > 0) {
    db.prepare("UPDATE sync_jobs SET status='failed', finished_at=datetime('now','localtime'), error_msg=COALESCE(NULLIF(error_msg,''),'服务器重启中断') WHERE status='running'").run();
    console.log('[SYNC] 清理 ' + stuckCount + ' 个残留 running 任务');
  }
  // 启动 pending 处理
  const pendingCount = db.prepare("SELECT COUNT(*) as c FROM sync_jobs WHERE status='pending'").get().c;
  if (pendingCount > 0) {
    console.log('[SYNC] 检测到 ' + pendingCount + ' 个待处理任务，开始恢复');
    processPendingJobs();
  }
}, 3000);

// POST /api/sync/all — SSE流式进度
router.post('/all', authGM, async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  const send = (data) => res.write('data: ' + JSON.stringify(data) + '\n\n');
  const videos = db.prepare('SELECT * FROM videos').all();
  const results = [];
  send({ type: 'start', total: videos.length });
  for (let i = 0; i < videos.length; i++) {
    const v = videos[i];
    send({ type: 'progress', current: i+1, total: videos.length, title: v.title });
    const r = await syncVideo(v);
    results.push(r);
    send({ type: 'result', result: r });
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  const ok = results.filter(r => r.ok).length;
  const skipped = results.filter(r => r.skipped).length;
  db.prepare('INSERT INTO changelog (action_type,target,reason) VALUES (?,?,?)').run(
    '自动同步', '全部视频', `同步完成：${ok}个成功，${skipped}个跳过`
  );
  send({ type: 'done', ok, skipped, results });
  res.end();
});

// GET /api/sync/status
router.get('/status', authGM, (req, res) => {
  const last = db.prepare("SELECT * FROM changelog WHERE action_type='自动同步' ORDER BY created_at DESC LIMIT 1").get();
  res.json({ last_sync: last?.created_at || null, last_result: last?.reason || null });
});

module.exports = router;
module.exports.syncVideo = syncVideo;
module.exports.syncVideoQuick = syncVideoQuick;
