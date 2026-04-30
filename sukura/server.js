const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const { PORT, JWT_SECRET } = require('./config');

const app = express();
const server = http.createServer(app);

// ─── WebSocket ─────────────────────────────────────────
const wss = new WebSocket.Server({ server });
// clients: Map<username, Set<ws>>
const clients = new Map();

wss.on('connection', (ws, req) => {
  // 从URL参数里拿token: ws://host/ws?token=xxx
  const url = new URL(req.url, 'http://localhost');
  const token = url.searchParams.get('token');
  let user = null;
  try { user = jwt.verify(token, JWT_SECRET); } catch(e) { ws.close(); return; }

  ws.userId = user.username;
  ws.userRole = user.role;
  if (!clients.has(user.username)) clients.set(user.username, new Set());
  clients.get(user.username).add(ws);

  ws.on('close', () => {
    const set = clients.get(user.username);
    if (set) { set.delete(ws); if (!set.size) clients.delete(user.username); }
  });

  // 心跳：标记存活，收到 pong 时刷新
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.send(JSON.stringify({ type: 'connected', username: user.username }));
});

// ─── WebSocket 心跳：30秒 ping 一次，下个周期没回应就踢 ──
const wsHeartbeat = setInterval(() => {
  wss.clients.forEach(ws => {
    if (ws.isAlive === false) {
      try { ws.terminate(); } catch(e) {}
      return;
    }
    ws.isAlive = false;
    try { ws.ping(); } catch(e) {}
  });
}, 30000);
wss.on('close', () => clearInterval(wsHeartbeat));

// 全局推送函数，挂到 app 上供路由使用
app.push = (username, payload) => {
  const set = clients.get(username);
  if (!set) return;
  const msg = JSON.stringify(payload);
  set.forEach(ws => { if (ws.readyState === WebSocket.OPEN) ws.send(msg); });
};
app.pushGM = (payload) => {
  clients.forEach((set, uname) => {
    set.forEach(ws => {
      if (ws.userRole === 'gm' && ws.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify(payload));
    });
  });
};

// ─── 目录 ──────────────────────────────────────────────
const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// upload路由最先注册，避免body被其他中间件消费
app.use('/api/upload', require('./routes/upload'));

app.use((req, res, next) => {
  express.json()(req, res, next);
});
app.use(express.static(path.join(__dirname, 'public')));

// 把 push 函数注入到每个请求
app.use((req, res, next) => { req.push = app.push; req.pushGM = app.pushGM; next(); });

// ─── 路由 ──────────────────────────────────────────────
app.use('/api/auth',       require('./routes/auth'));
app.use('/api/videos',     require('./routes/videos'));
app.use('/api/messages',   require('./routes/messages'));
app.use('/api/changelog',  require('./routes/changelog'));
app.use('/api/categories', require('./routes/categories'));
app.use('/api/users',      require('./routes/users'));
app.use('/api/bilibili',   require('./routes/bilibili'));
app.use('/api/announcements', require('./routes/announcements'));
app.use('/api/music',      require('./routes/music'));
app.use('/api/sync',       require('./routes/sync'));
app.use('/api/videos/:vid/music', require('./routes/videomusic'));
app.use('/api/videos/:vid/episodes', require('./routes/episodes'));
app.use('/api/videos/:vid/episodes/:epnum/music', require('./routes/episodemusic'));
app.use('/api/stats', require('./routes/stats'));

// B站图片代理（解决防盗链）
app.get('/imgproxy', (req, res) => {
  const url = req.query.url;
  if (!url || !url.startsWith('http')) return res.status(400).end();
  const https = require('https');
  const http = require('http');
  const client = url.startsWith('https') ? https : http;
  const proxyReq = client.get(url, {
    headers: {
      'Referer': 'https://www.bilibili.com',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
  }, proxyRes => {
    res.setHeader('Content-Type', proxyRes.headers['content-type'] || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    proxyRes.pipe(res);
  });
  proxyReq.on('error', () => res.status(500).end());
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 全局错误处理，确保返回JSON而不是HTML
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  res.status(500).json({ error: err.message || '服务器错误' });
});

// ─── 定时同步 ────────────────────────────────────────────
function scheduleSync() {
  const now = new Date();
  const next = new Date();
  next.setHours(3, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  const ms = next - now;
  const isWeeklyFull = next.getDay() === 0; // 周日做完整同步
  console.log(`✓ 下次自动同步：${next.toLocaleString('zh-CN')}（${isWeeklyFull?'完整':'快速'}，${Math.round(ms/3600000)}小时后）`);
  setTimeout(async () => {
    const { syncVideo, syncVideoQuick } = require('./routes/sync');
    const db = require('./db');
    const videos = db.prepare('SELECT * FROM videos').all();
    const isFullSync = new Date().getDay() === 0;
    console.log(`[SYNC] 开始${isFullSync?'完整':'快速'}同步...`);
    let ok = 0, skipped = 0;
    for (const v of videos) {
      try {
        const r = isFullSync ? await syncVideo(v) : await syncVideoQuick(v);
        if (r.ok) ok++; else skipped++;
        await new Promise(r => setTimeout(r, 500));
      } catch(e) { skipped++; }
    }
    db.prepare('INSERT INTO changelog (action_type,target,reason) VALUES (?,?,?)').run(
      isFullSync?'完整同步':'快速同步', '全部视频',
      `${isFullSync?'完整':'快速'}同步完成：${ok}个成功，${skipped}个跳过`
    );
    console.log(`[SYNC] 完成：${ok}成功，${skipped}跳过`);
    scheduleSync();
  }, ms);
}
scheduleSync();

server.listen(PORT, '127.0.0.1', () => {
  console.log(`✓ 沙雕库启动：http://localhost:${PORT}`);
});
