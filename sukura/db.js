const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

const db = new Database(path.join(dataDir, 'sukura.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── 建表 ───────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT DEFAULT 'user',
    nickname TEXT DEFAULT '',
    avatar TEXT DEFAULT '',
    avatar_status TEXT DEFAULT 'approved',
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT UNIQUE NOT NULL,
    label TEXT NOT NULL,
    sort INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS videos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    cat TEXT NOT NULL,
    cover TEXT DEFAULT '',
    emoji TEXT DEFAULT '🎬',
    desc TEXT NOT NULL,
    status TEXT DEFAULT 'ongoing',
    platforms TEXT DEFAULT '[]',
    plays INTEGER DEFAULT 0,
    eps INTEGER DEFAULT 0,
    pub_date TEXT DEFAULT '',
    last_update TEXT DEFAULT '',
    seasons TEXT DEFAULT '[]',
    notes TEXT DEFAULT '',
    author_name TEXT NOT NULL,
    author_avatar TEXT DEFAULT '',
    author_avatar_img TEXT DEFAULT '',
    author_color TEXT DEFAULT '#fb7299',
    author_fans INTEGER DEFAULT 0,
    author_platforms TEXT DEFAULT '[]',
    novel_name TEXT NOT NULL,
    novel_link TEXT NOT NULL,
    novel_author TEXT DEFAULT '',
    novel_chapters INTEGER DEFAULT 0,
    novel_finished INTEGER DEFAULT 0,
    novel_last_update TEXT DEFAULT '',
    author_recommends TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_user TEXT NOT NULL,
    type TEXT NOT NULL,
    content TEXT NOT NULL,
    reply TEXT DEFAULT NULL,
    reply_time TEXT DEFAULT NULL,
    is_read INTEGER DEFAULT 0,
    user_read INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS message_replies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER NOT NULL,
    sender TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    content TEXT DEFAULT '',
    image_url TEXT DEFAULT NULL,
    is_read INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS changelog (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action_type TEXT NOT NULL,
    target TEXT NOT NULL,
    reason TEXT NOT NULL,
    operator TEXT DEFAULT 'gm',
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS video_changelog (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id INTEGER NOT NULL,
    action_type TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY(video_id) REFERENCES videos(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS pending_avatars (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    avatar_url TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );
`);

// ─── 字段兼容迁移（ALTER IF NOT EXISTS 用 try/catch）───
const alters = [
  'ALTER TABLE users ADD COLUMN nickname TEXT DEFAULT ""',
  'ALTER TABLE users ADD COLUMN avatar TEXT DEFAULT ""',
  'ALTER TABLE users ADD COLUMN avatar_status TEXT DEFAULT "approved"',
  'ALTER TABLE messages ADD COLUMN user_read INTEGER DEFAULT 0',
  'ALTER TABLE videos ADD COLUMN status TEXT DEFAULT "ongoing"',
  'ALTER TABLE videos ADD COLUMN platforms TEXT DEFAULT "[]"',
  'ALTER TABLE videos ADD COLUMN seasons TEXT DEFAULT "[]"',
  'ALTER TABLE videos ADD COLUMN notes TEXT DEFAULT ""',
  'ALTER TABLE videos ADD COLUMN author_avatar_img TEXT DEFAULT ""',
  'ALTER TABLE videos ADD COLUMN author_platforms TEXT DEFAULT "[]"',
  "ALTER TABLE videos ADD COLUMN novel_author TEXT DEFAULT ''",
  "ALTER TABLE videos ADD COLUMN novel_chapters INTEGER DEFAULT 0",
  "ALTER TABLE videos ADD COLUMN novel_finished INTEGER DEFAULT 0",
  "ALTER TABLE videos ADD COLUMN novel_last_update TEXT DEFAULT ''",
  "ALTER TABLE videos ADD COLUMN author_recommends TEXT DEFAULT '[]'",
];
for (const sql of alters) {
  try { db.prepare(sql).run(); } catch(e) {}
}

// ─── 默认分类 ──────────────────────────────────────────
const bcrypt = require('bcryptjs');
const catCount = db.prepare('SELECT COUNT(*) as c FROM categories').get();
if (catCount.c === 0) {
  const inscat = db.prepare('INSERT INTO categories (key,label,sort) VALUES (?,?,?)');
  [['xuanhuan','玄幻修仙',1],['dushi','都市爽文',2],['lishi','历史穿越',3],
   ['xitong','系统流',4],['wuxia','武侠江湖',5],['mori','末日求生',6]]
  .forEach(([k,l,s]) => inscat.run(k,l,s));
}

// ─── 默认GM账号 ────────────────────────────────────────
const gmExists = db.prepare('SELECT id FROM users WHERE username = ?').get('gm');
if (!gmExists) {
  const hash = bcrypt.hashSync('gm123456', 10);
  db.prepare('INSERT INTO users (username,password,role,nickname) VALUES (?,?,?,?)').run('gm', hash, 'gm', 'GM');
  console.log('✓ 默认GM账号已创建: gm / gm123456');
}

// ─── 示例数据 ──────────────────────────────────────────
const videoCount = db.prepare('SELECT COUNT(*) as c FROM videos').get();
if (videoCount.c === 0) {
  const insert = db.prepare(`
    INSERT INTO videos (title,cat,emoji,desc,status,platforms,plays,eps,pub_date,last_update,
      author_name,author_avatar,author_color,author_fans,author_platforms,novel_name,novel_link,seasons,notes)
    VALUES (@title,@cat,@emoji,@desc,@status,@platforms,@plays,@eps,@pub_date,@last_update,
      @author_name,@author_avatar,@author_color,@author_fans,@author_platforms,@novel_name,@novel_link,@seasons,@notes)
  `);
  const defaults = [
    {title:'万古第一神',cat:'xuanhuan',emoji:'⚡',desc:'废柴少年意外获得上古神器，踏上逆天之路。沙雕配音还原度拉满，弹幕笑死人不偿命。',status:'ongoing',platforms:JSON.stringify([{name:'B站',link:'https://www.bilibili.com'}]),plays:8420000,eps:148,pub_date:'2023-01-15',last_update:'2025-04-20',author_name:'天降神棍君',author_avatar:'天',author_color:'#fb7299',author_fans:2340000,author_platforms:JSON.stringify([{platform:'B站',link:'https://space.bilibili.com',fans:2340000}]),novel_name:'万古第一神',novel_link:'https://fanqienovel.com',seasons:JSON.stringify([{name:'第一季',eps:80,note:''},{name:'第二季',eps:68,note:''}]),notes:''},
    {title:'都市最强赘婿',cat:'dushi',emoji:'💰',desc:'落魄赘婿身藏绝世身份，一朝爆发打脸全场。节奏极快，适合下班解压。',status:'finished',platforms:JSON.stringify([{name:'抖音',link:'https://www.douyin.com'}]),plays:6180000,eps:92,pub_date:'2023-06-10',last_update:'2025-04-21',author_name:'阿Q动漫',author_avatar:'Q',author_color:'#23ade5',author_fans:1890000,author_platforms:JSON.stringify([{platform:'抖音',link:'https://www.douyin.com',fans:1890000}]),novel_name:'赘婿当道',novel_link:'https://qimao.com',seasons:'[]',notes:''},
    {title:'大秦：我是始皇他弟',cat:'lishi',emoji:'🏯',desc:'现代人穿越成秦始皇弟弟，靠着超前知识玩转朝堂，历史还原与沙雕改编完美融合。',status:'hiatus',platforms:JSON.stringify([{name:'快手',link:'https://www.kuaishou.com'}]),plays:5320000,eps:76,pub_date:'2023-09-01',last_update:'2025-04-19',author_name:'历史说书人',author_avatar:'历',author_color:'#f4a728',author_fans:980000,author_platforms:JSON.stringify([{platform:'快手',link:'https://www.kuaishou.com',fans:980000}]),novel_name:'始皇之弟传奇',novel_link:'https://qidian.com',seasons:'[]',notes:'作者曾于2024年短暂停更3个月'},
  ];
  defaults.forEach(v => insert.run(v));
  console.log('✓ 示例数据已写入');
}

// ─── 旧消息迁移到 message_replies ────────────────────
const migrated = db.prepare('SELECT COUNT(*) as c FROM message_replies').get();
if (migrated.c === 0) {
  const oldReplies = db.prepare('SELECT id,from_user,content,reply,reply_time,created_at FROM messages WHERE reply IS NOT NULL').all();
  const ins = db.prepare('INSERT INTO message_replies (message_id,sender,role,content,is_read,created_at) VALUES (?,?,?,?,?,?)');
  for (const m of oldReplies) {
    ins.run(m.id, m.from_user, 'user', m.content, 1, m.created_at);
    ins.run(m.id, 'gm', 'gm', m.reply, 1, m.reply_time || m.created_at);
  }
  if (oldReplies.length > 0) console.log(`✓ 迁移了 ${oldReplies.length} 条旧对话`);
}

// 音乐播放列表
db.exec(`
  CREATE TABLE IF NOT EXISTS music (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    artist TEXT DEFAULT '',
    cover TEXT DEFAULT '',
    url TEXT NOT NULL,
    lyrics TEXT DEFAULT '',
    lyrics_type TEXT DEFAULT 'lrc',
    sort INTEGER DEFAULT 0,
    source_link TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );
`);


// ─── 补全表（之前手工建的，现在统一管理） ────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS video_categories (
    video_id INTEGER NOT NULL,
    cat_key TEXT NOT NULL,
    PRIMARY KEY(video_id, cat_key),
    FOREIGN KEY(video_id) REFERENCES videos(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS video_episodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id INTEGER NOT NULL,
    ep_num INTEGER NOT NULL,
    bvid TEXT NOT NULL,
    title TEXT DEFAULT '',
    cover TEXT DEFAULT '',
    duration INTEGER DEFAULT 0,
    pubdate TEXT DEFAULT '',
    views INTEGER DEFAULT 0,
    danmaku INTEGER DEFAULT 0,
    likes INTEGER DEFAULT 0,
    coins INTEGER DEFAULT 0,
    favorites INTEGER DEFAULT 0,
    shares INTEGER DEFAULT 0,
    comments INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY(video_id) REFERENCES videos(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS video_stats_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id INTEGER NOT NULL,
    plays INTEGER DEFAULT 0,
    likes INTEGER DEFAULT 0,
    coins INTEGER DEFAULT 0,
    favorites INTEGER DEFAULT 0,
    shares INTEGER DEFAULT 0,
    comments INTEGER DEFAULT 0,
    danmakus INTEGER DEFAULT 0,
    sync_at TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY(video_id) REFERENCES videos(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS episode_stats_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id INTEGER NOT NULL,
    ep_num INTEGER NOT NULL,
    bvid TEXT,
    views INTEGER DEFAULT 0,
    likes INTEGER DEFAULT 0,
    coins INTEGER DEFAULT 0,
    favorites INTEGER DEFAULT 0,
    shares INTEGER DEFAULT 0,
    comments INTEGER DEFAULT 0,
    danmaku INTEGER DEFAULT 0,
    sync_at TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS author_stats_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    author_name TEXT NOT NULL,
    fans INTEGER DEFAULT 0,
    total_plays INTEGER DEFAULT 0,
    total_likes INTEGER DEFAULT 0,
    total_coins INTEGER DEFAULT 0,
    total_favorites INTEGER DEFAULT 0,
    total_shares INTEGER DEFAULT 0,
    total_comments INTEGER DEFAULT 0,
    total_danmakus INTEGER DEFAULT 0,
    sync_at TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS video_music (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    artist TEXT DEFAULT '',
    cover TEXT DEFAULT '',
    source_link TEXT DEFAULT '',
    eps_used TEXT DEFAULT '',
    plays INTEGER DEFAULT 0,
    likes INTEGER DEFAULT 0,
    favorites INTEGER DEFAULT 0,
    coins INTEGER DEFAULT 0,
    comments INTEGER DEFAULT 0,
    shares INTEGER DEFAULT 0,
    sort INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY(video_id) REFERENCES videos(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS episode_music (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id INTEGER NOT NULL,
    ep_num INTEGER NOT NULL,
    music_id INTEGER,
    title TEXT NOT NULL,
    artist TEXT DEFAULT '',
    source_link TEXT DEFAULT '',
    video_link TEXT DEFAULT '',
    timestamp INTEGER DEFAULT 0,
    sort INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    FOREIGN KEY(video_id) REFERENCES videos(id) ON DELETE CASCADE,
    FOREIGN KEY(music_id) REFERENCES music(id) ON DELETE SET NULL
  );
`);

// ─── 补全字段：videos 表的同步统计字段 ──
const alters2 = [
  'ALTER TABLE videos ADD COLUMN likes INTEGER DEFAULT 0',
  'ALTER TABLE videos ADD COLUMN coins INTEGER DEFAULT 0',
  'ALTER TABLE videos ADD COLUMN favorites INTEGER DEFAULT 0',
  'ALTER TABLE videos ADD COLUMN shares INTEGER DEFAULT 0',
  'ALTER TABLE videos ADD COLUMN comments INTEGER DEFAULT 0',
  'ALTER TABLE videos ADD COLUMN danmakus INTEGER DEFAULT 0',
  'ALTER TABLE videos ADD COLUMN last_sync_at TEXT DEFAULT NULL',
  'ALTER TABLE videos ADD COLUMN last_sync_result TEXT DEFAULT NULL',
  "ALTER TABLE videos ADD COLUMN orig_link TEXT DEFAULT ''",
];
for (const sql of alters2) {
  try { db.prepare(sql).run(); } catch(e) {}
}

module.exports = db;
