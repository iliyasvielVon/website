const express = require('express');
const { downloadImg } = require('./imgutil');
const router = express.Router();
const https = require('https');
const { authGM } = require('../middleware/auth');

function bget(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.bilibili.com',
      path,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://space.bilibili.com/'
      }
    };
    https.get(options, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error('解析失败')); }
      });
    }).on('error', reject);
  });
}

router.get('/search', authGM, async (req, res) => {
  const { keyword = '沙雕动画', page = 1 } = req.query;
  try {
    const kw = encodeURIComponent(keyword);
    const data = await bget(`/x/web-interface/search/type?search_type=video&keyword=${kw}&order=pubdate&duration=4&page=${page}`);
    if (data.code !== 0) return res.status(400).json({ error: data.message });
    const results = (data.data?.result || []).map(r => ({
      bvid: r.bvid,
      title: r.title.replace(/<[^>]+>/g, ''),
      author: r.author, mid: r.mid,
      cover: r.pic.startsWith('//') ? 'https:' + r.pic : r.pic,
      plays: r.play, duration: r.duration,
      pubdate: r.pubdate, desc: r.description,
      videoLink: 'https://www.bilibili.com/video/' + r.bvid,
      authorLink: 'https://space.bilibili.com/' + r.mid,
      copyright: r.copyright, isUnion: r.is_union_video,
    }));
    res.json({ results, total: data.data?.numResults || 0, page: Number(page) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/space', authGM, async (req, res) => {
  const { mid } = req.query;
  if (!mid) return res.status(400).json({ error: '缺少mid' });
  try {
    const [info, stat] = await Promise.all([
      bget(`/x/space/wbi/acc/info?mid=${mid}`),
      bget(`/x/relation/stat?vmid=${mid}`)
    ]);
    res.json({
      name: info.data?.name || '',
      avatar: info.data?.face || '',
      fans: stat.data?.follower || 0,
      sign: info.data?.sign || '',
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/videos', authGM, async (req, res) => {
  const { mid } = req.query;
  if (!mid) return res.status(400).json({ error: '缺少mid' });
  try {
    const data = await bget(`/x/space/wbi/arc/search?mid=${mid}&ps=30&pn=1&order=pubdate`);
    const list = (data.data?.list?.vlist || []).map(v => ({
      bvid: v.bvid, title: v.title, cover: v.pic,
      plays: v.play, created: v.created,
      link: 'https://www.bilibili.com/video/' + v.bvid,
    }));
    res.json({ list });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/bilibili/seasons?mid=xxx
router.get('/seasons', authGM, async (req, res) => {
  const { mid } = req.query;
  if (!mid) return res.status(400).json({ error: '缺少mid' });
  try {
    const [data, info, stat] = await Promise.all([
      bget('/x/polymer/web-space/home/seasons_series?mid='+mid+'&page_num=1&page_size=20'),
      bget('/x/space/wbi/acc/info?mid='+mid),
      bget('/x/relation/stat?vmid='+mid)
    ]);
    if (data.code !== 0) return res.status(400).json({ error: data.message });
    const seasons = (data.data?.items_lists?.seasons_list || []).map(s => ({
      id: s.meta?.season_id,
      name: s.meta?.name,
      cover: s.meta?.cover,
      total: s.meta?.total,
    }));
    res.json({
      seasons,
      author: {
        name: info.data?.name || '',
        avatar: info.data?.face || '',
        fans: stat.data?.follower || 0,
        mid,
      }
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/bilibili/season-videos?mid=&season_id=
router.get('/season-videos', authGM, async (req, res) => {
  const { mid, season_id } = req.query;
  if (!mid || !season_id) return res.status(400).json({ error: '缺少mid或season_id' });
  try {
    const data = await bget('/x/polymer/web-space/seasons_archives_list?mid='+mid+'&season_id='+season_id+'&page_num=1&page_size=30');
    if (data.code !== 0) return res.status(400).json({ error: data.message });
    const bvids = (data.data?.archives || []).map(a => a.bvid);
    res.json({ bvids });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/bilibili/video?bvid=xxx — 获取单个视频信息填表用
router.get('/video', authGM, async (req, res) => {
  const { bvid } = req.query;
  if (!bvid) return res.status(400).json({ error: '缺少 bvid' });
  try {
    const v = await bget('/x/web-interface/view?bvid=' + bvid);
    if (v.code !== 0) return res.status(400).json({ error: 'B站返回: ' + v.message });
    const d = v.data;
    const mid = d.owner?.mid;
    let author_fans = 0;
    try {
      const stat = await bget('/x/relation/stat?vmid=' + mid);
      author_fans = stat.data?.follower || 0;
    } catch(e) {}
    // 尝试下载封面到本地
    let coverPath = d.pic || '';
    if (coverPath) {
      try {
        const localCover = await downloadImg(coverPath, 'cover_tmp_' + bvid);
        if (localCover) coverPath = localCover;
      } catch(e) {}
    }
    res.json({
      title: d.title || '',
      cover: coverPath,
      desc: d.desc || '',
      pages: d.videos || 1,
      plays: d.stat?.view || 0,
      pubdate: d.pubdate || 0,
      author: d.owner?.name || '',
      author_mid: mid || '',
      author_fans,
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
