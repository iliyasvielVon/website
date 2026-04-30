// ─── STATE ────────────────────────────────────────────────
let token = localStorage.getItem('sd_token');
let currentUser = JSON.parse(localStorage.getItem('sd_user')||'null');
let currentCat = 'all';
let currentChatId = null;
let pendingImgUrl = null;
let ws = null;

// ─── API ──────────────────────────────────────────────────
async function api(path, opts={}) {
  const headers = {'Content-Type':'application/json'};
  if (token) headers['Authorization'] = 'Bearer '+token;
  const res = await fetch('/api'+path, {...opts, headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined});
  const data = await res.json();
  if (!res.ok) throw new Error(data.error||'请求失败');
  return data;
}

// ─── WEBSOCKET ────────────────────────────────────────────
function connectWS() {
  if (!token) return;
  if (ws && ws.readyState < 2) ws.close();
  const proto = location.protocol==='https:'?'wss':'ws';
  ws = new WebSocket(`${proto}://${location.host}?token=${token}`);
  ws.onmessage = e => {
    const msg = JSON.parse(e.data);
    if (msg.type==='gm_reply') {
      showToast('💬 GM回复了你的消息','info');
      refreshInboxBadge();
      if (currentChatId===msg.topic_id) {
        loadChatMsgs(msg.topic_id);
      } else {
        // 收件箱列表也刷新
        if (document.getElementById('inboxPanel').classList.contains('open')) loadInboxList();
      }
    }
    if (msg.type==='avatar_approved') {
      showToast('✓ 头像已审核通过','success');
      currentUser.avatar = msg.avatar;
      localStorage.setItem('sd_user', JSON.stringify(currentUser));
      updateAuthUI();
    }
    if (msg.type==='avatar_rejected') {
      showToast('头像审核未通过，请更换后重新提交','error');
    }
  };
  ws.onclose = () => { if (token) setTimeout(connectWS, 5000); };
  ws.onerror = () => {};
}

// ─── HELPERS ─────────────────────────────────────────────
function fmt(n) {
  n=Number(n)||0;
  if(n>=10000000) return (n/10000000).toFixed(1)+'千万';
  if(n>=10000) return (n/10000).toFixed(1)+'万';
  return n;
}
function setFavicon(url) {
  if (!url) {
    document.querySelector('link[rel="icon"]').href = '/favicon.svg';
    return;
  }
  // 如果是B站图片，用代理
  const finalUrl = (url.includes('hdslb.com') || url.includes('biliimg.com')) ? '/imgproxy?url='+encodeURIComponent(url) : url;
  document.querySelector('link[rel="icon"]').href = finalUrl;
}
function bimg(url) {
  if (!url) return '';
  if (url.includes('hdslb.com') || url.includes('biliimg.com') || url.includes('bilibili.com')) {
    return '/imgproxy?url=' + encodeURIComponent(url);
  }
  return url;
}
function escH(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function showToast(msg,type='success'){
  const t=document.getElementById('toast');
  t.textContent=msg; t.className='toast '+type; t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'),3500);
}
function fmtBadge(n){
  if(!n||n<=0) return '';
  if(n>9999) return '9999+'; if(n>999) return '999+'; if(n>99) return '99+';
  return String(n);
}
const STATUS_LABEL = {ongoing:'更新中',finished:'已完结',hiatus:'断更中'};
const STATUS_CLASS = {ongoing:'ongoing',finished:'finished',hiatus:'hiatus'};

// ─── CATEGORIES ──────────────────────────────────────────
let allCats = [];
async function loadCats() {
  try {
    allCats = await api('/categories');
    const bar = document.getElementById('catBar');
    bar.innerHTML = '<div class="cat-item active" onclick="filterCat(\'all\',this)">全部</div>'
      + allCats.map(c=>`<div class="cat-item" onclick="filterCat('${c.key}',this)">${escH(c.label)}</div>`).join('');
  } catch(e){}
}

// ─── CARDS ───────────────────────────────────────────────
function cardHTML(v) {
  const firstPlatLink = v.platforms&&v.platforms[0] ? v.platforms[0].link : '#';
  const firstPlatName = v.platforms&&v.platforms[0] ? v.platforms[0].name : '去看';
  const statusCls = STATUS_CLASS[v.status]||'ongoing';
  const statusLabel = STATUS_LABEL[v.status]||'更新中';
  const avHtml = v.author.avatarImg
    ? `<img src="${bimg(v.author.avatarImg)}" alt="">`
    : v.author.avatar;
  return `<div class="vcard">
    <div class="vcard-cover" onclick="openDetail(${v.id})">
      ${v.cover ? `<img src="${escH(v.cover)}" loading="lazy" onerror="this.style.display='none'">` : ''}
      <div class="cover-ph" style="${v.cover?'display:none':''}">${v.emoji||'🎬'}</div>
      <button class="play-btn-tl" onclick="event.stopPropagation();window.open('${escH(firstPlatLink)}','_blank')">▶ ${escH(firstPlatName)}</button>
      <span class="status-tag ${statusCls}">${statusLabel}</span>
      <span class="vcard-eps">共${v.eps}集</span>

    </div>
            
    <div class="vcard-body">
      <div class="vcard-title">${escH(v.title)} <span style="font-size:11px;color:var(--text2);font-weight:400">▶ ${fmt(v.plays)}</span></div>
      <div class="vcard-engage-grid">
        <span><svg viewBox="0 0 16 16" width="11" height="11" fill="currentColor"><path d="M9.08 3a.75.75 0 0 0-.712.51L6.5 9H3.75a.75.75 0 0 0-.75.75v3.5c0 .414.336.75.75.75H12a1.5 1.5 0 0 0 1.47-1.2l.787-4a1.5 1.5 0 0 0-1.47-1.8H9.844l.393-1.97A1.5 1.5 0 0 0 9.08 3zM2 9.75A.75.75 0 0 1 2.75 9H3v4h-.25A.75.75 0 0 1 2 12.25V9.75z"/></svg>${fmt(v.likes||0)}</span>
        <span><svg viewBox="0 0 16 16" width="11" height="11" fill="currentColor"><path d="M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1zm0 1.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11zM8 4c.69 0 1.246.15 1.67.45.424.3.63.71.63 1.23 0 .36-.1.665-.302.915-.2.25-.474.43-.82.54v.03c.415.09.74.284.975.58.235.297.352.662.352 1.095 0 .563-.21 1.005-.63 1.325C9.455 10.457 8.853 10.617 8 10.617c-.707 0-1.274-.1-1.7-.302v-1.13c.217.12.464.216.74.287.277.07.553.106.828.106.41 0 .72-.075.93-.225a.73.73 0 0 0 .314-.634.68.68 0 0 0-.314-.6c-.21-.143-.53-.215-.96-.215H7.1V7h.667c.39 0 .686-.072.888-.215a.686.686 0 0 0 .303-.598c0-.25-.098-.44-.294-.57-.196-.13-.476-.195-.84-.195-.49 0-.966.126-1.424.38V4.83C6.742 4.277 7.305 4 8 4z"/></svg>${fmt(v.coins||0)}</span>
        <span><svg viewBox="0 0 16 16" width="11" height="11" fill="currentColor"><path d="M8 1.2l1.834 3.715 4.099.596-2.966 2.89.7 4.083L8 10.4l-3.667 1.927.7-4.083-2.966-2.89 4.099-.596z"/></svg>${fmt(v.favorites||0)}</span>
        <span><svg viewBox="0 0 16 16" width="11" height="11" fill="currentColor"><path d="M11 2.5a2.5 2.5 0 1 1 .871 1.906L5.963 7.37a2.507 2.507 0 0 1 0 1.26l5.908 2.964a2.5 2.5 0 1 1-.67 1.341L5.293 9.97a2.5 2.5 0 1 1 0-3.94l5.908-2.964A2.503 2.503 0 0 1 11 2.5z"/></svg>${fmt(v.shares||0)}</span>
        <span><svg viewBox="0 0 16 16" width="11" height="11" fill="currentColor"><path d="M14.5 2A1.5 1.5 0 0 1 16 3.5v7A1.5 1.5 0 0 1 14.5 12H8.621l-2.87 2.871A.75.75 0 0 1 4.5 14.25V12H1.5A1.5 1.5 0 0 1 0 10.5v-7A1.5 1.5 0 0 1 1.5 2h13z"/></svg>${fmt(v.danmakus||0)}</span>
        <span><svg viewBox="0 0 16 16" width="11" height="11" fill="currentColor"><path d="M14.5 2A1.5 1.5 0 0 1 16 3.5v7A1.5 1.5 0 0 1 14.5 12H8.621l-2.87 2.871A.75.75 0 0 1 4.5 14.25V12H1.5A1.5 1.5 0 0 1 0 10.5v-7A1.5 1.5 0 0 1 1.5 2h13z"/></svg>${fmt(v.comments||0)}</span>
      </div>
      <div class="vcard-stats">
        <span>📅 ${v.pubDate||'-'} ~ ${v.lastUpdate||'-'}</span>
      </div>

      <div class="vcard-author">
        <div class="author-av" style="background:${v.author.color}" onclick="event.stopPropagation();openAuthor('${encodeURIComponent(v.author.name)}')">${avHtml}</div>
        <div style="flex:1;min-width:0">
          <div class="author-name" onclick="openAuthor('${encodeURIComponent(v.author.name)}')">${escH(v.author.name)}</div>
          <div class="author-fans">粉丝 ${fmt(v.author.fans)}</div>
        </div>
      </div>
      <div class="vcard-novel">📖 <a href="${escH(v.novel.link)}" target="_blank" onclick="event.stopPropagation()">${escH(v.novel.name)}</a></div>
    </div>
  </div>`;
}

async function loadCards(cat, q) {
  const grid = document.getElementById('cardGrid');
  grid.innerHTML = '<div class="loading">加载中...</div>';
  try {
    const params = new URLSearchParams();
    if (cat && cat!=='all') params.set('cat', cat);
    if (q) params.set('q', q);
    const videos = await api('/videos?'+params);
    window._pages.cards = {
      data: videos,
      page: 1,
      pageSize: 12,
      scrollTarget: 'cardGrid',
      render: renderCardsPage,
    };
    renderCardsPage();
  } catch(e) { grid.innerHTML='<div class="loading">加载失败，请刷新</div>'; }
}

function renderCardsPage() {
  const state = window._pages.cards;
  if (!state) return;
  const grid = document.getElementById('cardGrid');
  if (!grid) return;
  if (!state.data.length) {
    grid.innerHTML = '<div class="loading">暂无内容</div>';
    // 清掉外部分页器
    const ext = document.getElementById('cardsPaginator');
    if (ext) ext.innerHTML = '';
    return;
  }
  const slice = paginateSlice(state.data, state.page, state.pageSize);
  const paginatorHtml = renderPaginator({ total: state.data.length, page: state.page, pageSize: state.pageSize, key: 'cards' });
  // 把分页器塞到 sectionTitle 旁边（如果存在容器），否则放在 grid 上方
  let extPg = document.getElementById('cardsPaginator');
  if (!extPg) {
    const title = document.getElementById('sectionTitle');
    if (title) {
      // 包裹 sectionTitle + 分页器到一个 sec-head 容器
      if (!title.parentElement.classList.contains('sec-head')) {
        const wrap = document.createElement('div');
        wrap.className = 'sec-head';
        title.parentNode.insertBefore(wrap, title);
        wrap.appendChild(title);
      }
      extPg = document.createElement('div');
      extPg.id = 'cardsPaginator';
      extPg.className = 'sec-pg';
      title.parentElement.appendChild(extPg);
    }
  }
  if (extPg) extPg.innerHTML = paginatorHtml;
  // 直接渲染卡片到 grid（外层 #cardGrid 已经是 .card-grid 类，是 grid 容器）
  grid.innerHTML = slice.map(cardHTML).join('');
}

// 统一构建首页卡片 URL（带 q/cat/page 参数）
function syncCardsURL() {
  const q = (document.getElementById('searchInput')?.value || '').trim();
  const cat = (typeof currentCat !== 'undefined' ? currentCat : window.currentCat) || 'all';
  const page = window._pages?.cards?.page || 1;
  const params = [];
  if (q) params.push('q=' + encodeURIComponent(q));
  if (cat && cat !== 'all') params.push('cat=' + cat);
  if (page > 1) params.push('page=' + page);
  const url = params.length ? '/?' + params.join('&') : '/';
  history.replaceState(null, '', url);
}

function filterCat(cat, el) {
  currentCat = cat;
  window.currentCat = cat;  // 让 syncCardsURL 能读到
  document.querySelectorAll('.cat-item').forEach(i=>i.classList.remove('active'));
  el.classList.add('active');
  const q = document.getElementById('searchInput').value.trim();
  if (q) {
    const catLabel = el.textContent.trim();
    document.getElementById('sectionTitle').textContent = `🔍 "${q}" 的结果（${catLabel}）`;
  } else {
    document.getElementById('sectionTitle').textContent = '🔥 热度排行';
  }
  loadCards(cat, q).then(() => {
    // 加载完成后 syncCardsURL 会读到正确的 page=1
    if (typeof syncCardsURL === 'function') syncCardsURL();
  });
}

function doSearch() {
  const q = document.getElementById('searchInput').value.trim();
  const isHome = (location.pathname === '/' || location.pathname === '');

  // 跨页面：先关闭所有弹层 + 改 URL（不调 applyRoute，避免它显示首页又被搜索覆盖造成闪屏）
  if (!isHome) {
    document.getElementById('detailPage')?.classList.remove('open');
    document.getElementById('episodePage')?.classList.remove('open');
    document.getElementById('authorPage')?.classList.remove('open');
    document.body.style.overflow = '';
    setFavicon(null);
    const url = q ? '/?q=' + encodeURIComponent(q) : '/';
    history.pushState(null, '', url);
  }

  // 执行搜索（首页/跨页统一逻辑）
  if (!q) {
    document.getElementById('sectionTitle').textContent='🔥 热度排行';
    history.replaceState(null, '', '/');
    loadCards(currentCat);
    return;
  }
  const catLabel = document.querySelector('.cat-item.active').textContent.trim();
  document.getElementById('sectionTitle').textContent = `🔍 "${q}" 的结果（${catLabel}）`;
  loadCards(currentCat, q).then(() => {
    if (typeof syncCardsURL === 'function') syncCardsURL();
  });
}
document.getElementById('searchInput').addEventListener('keydown', e=>{ if(e.key==='Enter') doSearch(); });
document.getElementById('searchInput').addEventListener('input', function(){
  if (!this.value.trim()) {
    document.getElementById('sectionTitle').textContent='🔥 热度排行';
    history.replaceState(null, '', '/');
    loadCards(currentCat);
  }
});

// ─── DETAIL ──────────────────────────────────────────────
async function openDetail(id, opts={}) {
  document.getElementById('detailContent').innerHTML='<div class="loading" style="padding:60px">加载中...</div>';
  document.getElementById('detailPage').classList.add('open');
  document.body.style.overflow='hidden';
  try {
    const v = await api('/videos/'+id);
    const cl = v.changelog||[];
    // 同时加载使用的音乐和分集数据
    let vmusic = [], episodes = [];
    try { vmusic = await api('/videos/'+id+'/music'); } catch(e){}
    try { episodes = await api('/videos/'+id+'/episodes'); } catch(e){}
    const seasons = v.seasons||[];
    const platLinks = (v.platforms||[]).map(p=>
      `<a href="${escH(p.link)}" target="_blank" class="link-btn primary">▶ 去${escH(p.name)}观看</a>`
    ).join('');
    const authorAvHtml = v.author.avatarImg
      ? `<img src="${bimg(v.author.avatarImg)}" alt="">`
      : v.author.avatar;
    const authorPlatLinks = (v.author.platforms||[]).map(p=>
      `<a href="${escH(p.link)}" target="_blank" class="plat-link-btn">${escH(p.platform)} · ${fmt(p.fans)}粉丝</a>`
    ).join('');
    const novelExtra = (v.novel.author||v.novel.chapters) ? `
      <div style="margin-top:10px;font-size:13px;color:var(--text2);display:flex;gap:14px;flex-wrap:wrap">
        ${v.novel.author?`<span>✍️ ${escH(v.novel.author)}</span>`:''}
        ${v.novel.chapters?`<span>📚 ${v.novel.chapters}章</span>`:''}
        <span>${v.novel.finished?'✅ 已完结':'📖 连载中'}</span>
        ${v.novel.lastUpdate?`<span>🔄 ${v.novel.lastUpdate}</span>`:''}
      </div>` : '';
    const recommends = (v.authorRecommends&&v.authorRecommends.length) ? `
      <div style="margin-top:10px">
        <div style="font-size:12px;color:var(--text2);margin-bottom:5px">📌 作者推荐书单</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">${v.authorRecommends.map(r=>
          r.link?`<a href="${escH(r.link)}" target="_blank" class="plat-link-btn">${escH(r.name)}</a>`
                :`<span class="plat-link-btn" style="cursor:default">${escH(r.name)}</span>`
        ).join('')}</div>
      </div>` : '';
    document.getElementById('detailContent').innerHTML = `
      <div class="back-row"><button class="back-btn home-btn" onclick="goHome()" title="返回主页">🏠 主页</button><button class="back-btn" onclick="closeDetail()">← 返回</button></div>
      <div class="detail-hero">
        <div class="detail-cover">${v.cover?`<img src="${escH(v.cover)}">`:`${v.emoji||'🎬'}`}</div>
        <div class="detail-info">
          <div class="detail-title">${escH(v.title)}<span class="detail-status ${STATUS_CLASS[v.status]||'ongoing'}">${STATUS_LABEL[v.status]||'更新中'}</span></div>
          <div class="detail-meta">
            <span>▶ ${fmt(v.plays)} 播放</span><span>📺 共${v.eps}集</span>
            <span>📅 ${v.pubDate||'-'}</span><span>🔄 ${v.lastUpdate||'-'}</span>
          </div>
          ${(v.likes||v.coins||v.favorites)?`<div class="detail-meta" style="margin-top:4px">
            ${v.likes?`<span>👍 ${fmt(v.likes)}</span>`:''}
            ${v.coins?`<span>🪙 ${fmt(v.coins)}</span>`:''}
            ${v.favorites?`<span>⭐ ${fmt(v.favorites)}</span>`:''}
            ${v.shares?`<span>↗ ${fmt(v.shares)}</span>`:''}
            ${v.comments?`<span>💬 ${fmt(v.comments)}</span>`:''}
            ${v.danmakus?`<span>💬弹 ${fmt(v.danmakus)}</span>`:''}
          </div>`:''}
          <div class="detail-desc">${escH(v.desc)}</div>
          ${v.notes?`<div class="detail-notes">📝 ${escH(v.notes)}</div>`:''}
          <div class="detail-links">
            ${platLinks}
            <a href="${escH(v.novel.link)}" target="_blank" class="link-btn secondary">📖 原著《${escH(v.novel.name)}》</a>
          </div>
          ${novelExtra}
          ${recommends}
        </div>
      </div>
      ${seasons.length?`<div class="detail-sec"><h3>季度信息</h3><div class="seasons-list">${seasons.map(s=>`
        <div class="season-item"><span class="sn">${escH(s.name)}</span><span class="se">${s.eps||0}集</span>${s.note?`<span class="snote">${escH(s.note)}</span>`:''}</div>`).join('')}
      </div></div>`:''}
      ${vmusic.length?`<div class="detail-sec">
        <h3 style="display:flex;align-items:center;gap:8px">使用的音乐
          <span style="font-size:11px;color:var(--text2);font-weight:400;background:var(--bg3);padding:2px 8px;border-radius:10px;cursor:default" title="点击歌曲图片、名字或作者可跳转到原创出处">💡 点击封面/名字/作者可跳转原创出处</span>
        </h3>
        <div style="max-height:${Math.min(vmusic.length,10)*88}px;overflow-y:auto;display:flex;flex-direction:column;gap:8px;padding-right:4px">
          ${vmusic.map(m=>`
          <div style="background:var(--bg3);border-radius:10px;padding:12px;display:flex;gap:12px;align-items:flex-start">
            <div style="width:52px;height:52px;border-radius:8px;overflow:hidden;background:var(--bg4);flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:24px;${m.source_link?'cursor:pointer':''}" ${m.source_link?`onclick="window.open('${escH(m.source_link)}','_blank')" title="点击跳转原创出处"`:''}>
              ${m.cover?`<img src="${escH(m.cover)}" style="width:100%;height:100%;object-fit:cover">`:'🎵'}
            </div>
            <div style="flex:1;min-width:0">
              <div style="font-size:14px;font-weight:500;margin-bottom:2px">
                ${m.source_link
                  ? `<a href="${escH(m.source_link)}" target="_blank" style="color:var(--text);text-decoration:none" onmouseover="this.style.color='var(--accent)'" onmouseout="this.style.color='var(--text)'">${escH(m.title)}</a>`
                  : escH(m.title)
                }
                ${m.artist?`<span style="font-size:12px;color:var(--text2);margin-left:6px">${m.source_link?`<a href="${escH(m.source_link)}" target="_blank" style="color:var(--text2);text-decoration:none" onmouseover="this.style.color='var(--accent)'" onmouseout="this.style.color='var(--text2)'">${escH(m.artist)}</a>`:escH(m.artist)}</span>`:''}
              </div>
              ${m.eps_used?`<div style="font-size:11px;color:var(--accent2);margin-bottom:4px">📺 使用于：${escH(m.eps_used)}</div>`:''}
              ${(m.plays||m.likes||m.favorites||m.coins||m.comments||m.shares)?`
              <div style="display:flex;gap:10px;flex-wrap:wrap;font-size:11px;color:var(--text2)">
                ${m.plays?`<span>▶ ${fmt(m.plays)}</span>`:''}
                ${m.likes?`<span>👍 ${fmt(m.likes)}</span>`:''}
                ${m.favorites?`<span>⭐ ${fmt(m.favorites)}</span>`:''}
                ${m.coins?`<span>🪙 ${fmt(m.coins)}</span>`:''}
                ${m.comments?`<span>💬 ${fmt(m.comments)}</span>`:''}
                ${m.shares?`<span>↗ ${fmt(m.shares)}</span>`:''}
              </div>`:''}
            </div>
          </div>`).join('')}
        </div>
      </div>`:''}
      <div class="detail-sec"><h3>作者信息</h3>
        <div class="author-card-d">
          <div class="av" style="background:${v.author.color}">${authorAvHtml}</div>
          <div style="flex:1">
            <div style="font-size:15px;font-weight:500">${escH(v.author.name)}</div>
            <div style="font-size:12px;color:var(--text2);margin-top:3px">全网粉丝 ${fmt(v.author.fans)}</div>
            ${authorPlatLinks?`<div class="plat-links">${authorPlatLinks}</div>`:''}
          </div>
          <button class="link-btn secondary" style="flex-shrink:0" onclick="navigateToAuthor('${encodeURIComponent(v.author.name)}')">主页</button>
        </div>
      </div>
      <div class="detail-sec" id="statsChart-${id}">
        <h3>数据趋势</h3>
        <div id="chartWrap-${id}"><div class="loading" style="padding:20px">加载中...</div></div>
      </div>
  ${episodes.length?`<div class="detail-sec">
        <div class="sec-head">
          <h3 id="epSecTitle-${id}">分集列表（共${episodes.length}集）</h3>
          <div id="epPaginator-${id}" class="sec-pg"></div>
        </div>
        <div class="ep-scroll-wrap" id="epWrap-${id}"><div class="ep-grid" id="epGrid-${id}"></div></div>
      </div>`:''}  `;
  // 初始化分集数据
  if (!opts.skipPush) {
    history.pushState(null, '', '/video/' + id + '-' + encodeURIComponent(v.title));
  }
  document.title = v.title + ' · 沙雕库';
  // 加载视频数据趋势图
  loadVideoChart(id);
  setFavicon(v.cover);
  if (episodes.length) {
    window._eps = window._eps || {};
    window._eps[id] = episodes;
    window._pages['eps_'+id] = {
      data: episodes,
      page: 1,
      pageSize: 20,
      scrollTarget: 'epSecTitle-'+id,
      render: () => renderEpsPage(id),
    };
    setTimeout(() => renderEpsPage(id), 50);
  }
  } catch(e) { document.getElementById('detailContent').innerHTML='<div class="loading">加载失败</div>'; }
}
async function openEpisode(videoId, epNum, opts={}) {
  const page = document.getElementById('episodePage');
  const content = document.getElementById('episodeContent');
  content.innerHTML = '<div class="loading" style="padding:60px">加载中...</div>';
  page.classList.add('open');
  document.body.style.overflow='hidden';
  try {
    const eps = await api('/videos/'+videoId+'/episodes');
    const ep = eps.find(e => e.ep_num === epNum);
    if (!ep) { content.innerHTML = '<div class="loading">未找到分集</div>'; return; }
    
    const v = await api('/videos/'+videoId);
    if (!opts.skipPush) {
      history.pushState(null, '', '/video/' + videoId + '-' + encodeURIComponent(v.title) + '/ep/' + epNum);
    }
    document.title = v.title + ' 第' + epNum + '集 · 沙雕库';
    setFavicon(ep.cover);
    
    content.innerHTML = `
      <div class="back-row"><button class="back-btn home-btn" onclick="goHome()" title="返回主页">🏠 主页</button><button class="back-btn" onclick="closeEpisode()">← 返回</button></div>
      <div class="detail-hero">
        <div class="detail-cover" style="cursor:pointer" onclick="window.open('https://www.bilibili.com/video/${ep.bvid}','_blank')">
          ${ep.cover?`<img src="${bimg(ep.cover)}">`:'🎬'}
        </div>
        <div class="detail-info">
          <div class="detail-title">第${ep.ep_num}集 · ${escH(ep.title)}</div>
          <div class="detail-meta">
            <span>所属：${escH(v.title)}</span>
            <span>📅 ${ep.pubdate||'-'}</span>
            <span>⏱ ${fmtDur(ep.duration)}</span>
          </div>
          <div class="detail-meta" style="margin-top:6px">
            <span>▶ ${fmt(ep.views)} 播放</span>
            <span>👍 ${fmt(ep.likes)}</span>
            <span>🪙 ${fmt(ep.coins)}</span>
            <span>⭐ ${fmt(ep.favorites)}</span>
            <span>↗ ${fmt(ep.shares)}</span>
            <span>💬 ${fmt(ep.comments)}</span>
            <span>弹 ${fmt(ep.danmaku)}</span>
          </div>
          <div class="detail-links" style="margin-top:14px">
            <a href="https://www.bilibili.com/video/${ep.bvid}" target="_blank" class="link-btn primary">▶ 去B站观看</a>
            <button class="link-btn secondary" onclick="navigateToVideo(${videoId})">📚 返回合集</button>
          </div>
        </div>
      </div>
      <div class="detail-sec" id="epMusicSec" style="display:none">
        <h3>使用的音乐</h3>
        <div id="epMusicList"></div>
      </div>
      <div class="detail-sec">
        <h3>数据趋势</h3>
        <div id="epChartWrap"><div class="loading" style="padding:20px">加载中...</div></div>
      </div>
    `;
    loadEpisodeChart(videoId, epNum);
    loadEpisodeMusic(videoId, epNum, ep.bvid);
  } catch(e) { content.innerHTML = '<div class="loading">加载失败</div>'; }
}
function closeEpisode() { history.back(); }

function goToVideoLink(videoLink, bvid, timestamp) {
  let url;
  if (videoLink && videoLink.trim()) {
    // 从video_link里提取URL
    const m = videoLink.match(/https?:\/\/[^\s]+/);
    url = m ? m[0] : 'https://www.bilibili.com/video/'+bvid+'?t='+timestamp;
  } else {
    url = 'https://www.bilibili.com/video/'+bvid+'?t='+timestamp;
  }
  window.open(url, '_blank');
}
async function loadEpisodeMusic(videoId, epNum, bvid) {
  try {
    const list = await api('/videos/'+videoId+'/episodes/'+epNum+'/music');
    if (!list.length) return;
    document.getElementById('epMusicSec').style.display = 'block';
    document.getElementById('epMusicList').innerHTML = list.map(m => `
      <div class="ep-music-item">
        <div class="ep-music-info">
          <div class="ep-music-title">
            ${m.source_link ? `<a href="${escH(m.source_link)}" target="_blank">${escH(m.title)}</a>` : escH(m.title)}
            ${m.artist ? `<span class="ep-music-artist">${m.source_link ? `<a href="${escH(m.source_link)}" target="_blank">${escH(m.artist)}</a>` : escH(m.artist)}</span>` : ''}
          </div>
          ${m.source_link ? `<div class="ep-music-source"><a href="${escH(m.source_link)}" target="_blank">查看音乐原创出处</a></div>` : ''}
          ${m.video_link ? (() => {
            // 去掉URL部分，只显示前面的描述文字
            const textOnly = m.video_link.replace(/https?:\/\/[^\s]+/g, '').trim();
            return textOnly ? `<div class="ep-music-vlink" onclick="goToVideoLink('${escH(m.video_link).replace(/'/g, '&#39;')}', '${bvid}', ${m.timestamp||0})" title="点击跳转视频">🎬 ${escH(textOnly)}</div>` : '';
          })() : ''}
        </div>
        <div class="ep-music-jump" onclick="goToVideoLink('${escH(m.video_link||'').replace(/'/g, '&#39;')}', '${bvid}', ${m.timestamp||0})" title="点击跳转到B站对应时间点">
          ${fmtDur(m.timestamp||0)}
        </div>
      </div>`).join('');
  } catch(e){}
}

async function loadEpisodeChart(videoId, epNum) {
  const wrap = document.getElementById('epChartWrap');
  if (!wrap) return;
  try {
    const data = await api('/stats/episode/'+videoId+'/'+epNum);
    if (!data.length) { wrap.innerHTML = '<div style="padding:20px;color:var(--text2);text-align:center;font-size:13px">暂无历史数据，下次同步后开始记录</div>'; return; }
    // 把views映射为plays
    const mapped = data.map(d => ({...d, plays: d.views}));
    wrap.innerHTML = renderChart(mapped, ['plays','likes','coins','favorites','shares','comments','danmaku']);
  } catch(e) { wrap.innerHTML = '<div style="padding:20px;color:#f44">加载失败</div>'; }
}

function closeDetail() { history.back(); }

// ─── AUTHOR ───────────────────────────────────────────────────────────────
async function openAuthor(nameEnc, opts={}) {
  const name = decodeURIComponent(nameEnc);
  document.getElementById('authorContent').innerHTML='<div class="loading" style="padding:60px">加载中...</div>';
  document.getElementById('authorPage').classList.add('open');
  document.body.style.overflow='hidden';
  try {
    const videos = await api('/videos?q='+encodeURIComponent(name));
    const works = videos.filter(v=>v.author.name===name);
    if (!works.length) { document.getElementById('authorContent').innerHTML='<div class="loading">未找到</div>'; return; }
    const a = works[0].author;
    const avHtml = a.avatarImg ? `<img src="${bimg(a.avatarImg)}" alt="">` : a.avatar;
    const platItems = (a.platforms||[]).map(p=>`
      <div class="author-plat-item">
        <a href="${escH(p.link)}" target="_blank">${escH(p.platform)}</a>
        <span class="author-plat-fans">粉丝 ${fmt(p.fans)}</span>
      </div>`).join('');
    if (!opts.skipPush) {
      history.pushState(null, '', '/author/' + encodeURIComponent(a.name));
    }
    document.title = a.name + ' · 沙雕库';
    setFavicon(a.avatarImg);
    setTimeout(() => loadAuthorChart(a.name), 100);
    document.getElementById('authorContent').innerHTML = `
      <div class="back-row"><button class="back-btn home-btn" onclick="goHome()" title="返回主页">🏠 主页</button><button class="back-btn" onclick="closeAuthor()">← 返回</button></div>
      <div class="author-hero">
        <div class="av" style="background:${a.color}">${avHtml}</div>
        <div class="author-hero-info">
          <h2>${escH(a.name)}</h2>
          <p>已收录 ${works.length} 部作品</p>
          ${platItems?`<div class="author-plat-list">${platItems}</div>`:''}
        </div>
        <div style="margin-left:auto;text-align:right;flex-shrink:0">
          <div style="font-size:24px;font-weight:700;color:var(--accent)">${fmt(a.fans)}</div>
          <div style="font-size:12px;color:var(--text2)">全网粉丝</div>
        </div>
      </div>
      <div class="detail-sec">
        <h3>数据趋势（全部作品总和）</h3>
        <div id="authorChartWrap"><div class="loading" style="padding:20px">加载中...</div></div>
      </div>
      <div class="section-title" id="authorWorksTitle">全部作品</div>
      <div id="authorWorksPaginator" style="display:flex;align-items:center;gap:10px;margin:10px 0;flex-wrap:wrap"></div>
      <div id="authorWorksWrap"></div>
    `;
    // 初始化作者作品分页
    window._pages.authorWorks = {
      data: works,
      page: 1,
      pageSize: 20,
      scrollTarget: 'authorWorksTitle',
      render: renderAuthorWorksPage,
    };
    renderAuthorWorksPage();
  } catch(e) { document.getElementById('authorContent').innerHTML='<div class="loading">加载失败</div>'; }
}

function renderAuthorWorksPage() {
  const state = window._pages.authorWorks;
  if (!state) return;
  const wrap = document.getElementById('authorWorksWrap');
  const pgEl = document.getElementById('authorWorksPaginator');
  if (!wrap) return;
  const slice = paginateSlice(state.data, state.page, state.pageSize);
  const total = state.data.length;
  const page = state.page;
  const totalPages = Math.max(1, Math.ceil(total / state.pageSize));
  if (pgEl) {
    if (totalPages <= 1) {
      pgEl.innerHTML = `<span style="color:var(--text2);font-size:12px">共 ${total} 部作品</span>`;
    } else {
      const prevDis = page <= 1 ? 'disabled style="opacity:0.4"' : '';
      const nextDis = page >= totalPages ? 'disabled style="opacity:0.4"' : '';
      pgEl.innerHTML = `
        <button class="back-btn" ${prevDis} onclick="goToPage('authorWorks', ${page-1})">← 上一页</button>
        <span style="color:var(--text2);font-size:13px">第 ${page} / ${totalPages} 页（共 ${total} 部）</span>
        <button class="back-btn" ${nextDis} onclick="goToPage('authorWorks', ${page+1})">下一页 →</button>
      `;
    }
  }
  wrap.className = 'card-grid';
  wrap.innerHTML = slice.map(cardHTML).join('');
}
function closeAuthor() { history.back(); }

// ─── AUTH ─────────────────────────────────────────────────────────────────
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
function switchModal(f,t) { closeModal(f); openModal(t); }
function toggleDD() { document.getElementById('userDD').classList.toggle('open'); }
document.addEventListener('click', e=>{ if(!e.target.closest('.user-menu')) document.getElementById('userDD')?.classList.remove('open'); });

async function doLogin() {
  const u=document.getElementById('lUser').value.trim(), p=document.getElementById('lPass').value;
  const err=document.getElementById('lErr');
  try {
    const data = await api('/auth/login',{method:'POST',body:{username:u,password:p}});
    token=data.token; currentUser={username:data.username,role:data.role,nickname:data.nickname||'',avatar:data.avatar||''};
    localStorage.setItem('sd_token',token); localStorage.setItem('sd_user',JSON.stringify(currentUser));
    closeModal('loginModal'); updateAuthUI(); showToast('登录成功 👋');
    if (data.role==='gm') window.location.href='/gm.html';
  } catch(e) { err.textContent=e.message; }
}

async function doRegister() {
  const u=document.getElementById('rUser').value.trim(), p=document.getElementById('rPass').value, p2=document.getElementById('rPass2').value;
  const err=document.getElementById('rErr');
  if (p!==p2) { err.textContent='两次密码不一致'; return; }
  try {
    const data = await api('/auth/register',{method:'POST',body:{username:u,password:p}});
    token=data.token; currentUser={username:data.username,role:data.role,nickname:'',avatar:''};
    localStorage.setItem('sd_token',token); localStorage.setItem('sd_user',JSON.stringify(currentUser));
    closeModal('registerModal'); updateAuthUI(); showToast('注册成功，欢迎！🎉');
  } catch(e) { err.textContent=e.message; }
}

function logout() {
  token=null; currentUser=null;
  localStorage.removeItem('sd_token'); localStorage.removeItem('sd_user');
  if (ws) ws.close(); ws=null;
  updateAuthUI(); document.getElementById('userDD').classList.remove('open');
  showToast('已退出登录');
}

function updateAuthUI() {
  const g=document.getElementById('guestBtns'), m=document.getElementById('userMenu'), av=document.getElementById('userAvatar');
  if (currentUser) {
    g.style.display='none'; m.style.display='flex';
    const displayName = currentUser.nickname || currentUser.username;
    if (currentUser.avatar) {
      av.innerHTML = `<img src="${escH(currentUser.avatar)}" alt="">`;
    } else {
      av.innerHTML = displayName[0].toUpperCase();
    }
    pollInboxUnread();
    connectWS();
  } else {
    g.style.display='flex'; m.style.display='none';
    clearInterval(window._inboxTimer);
  }
}

// ─── PROFILE ──────────────────────────────────────────────────────────────
async function openProfile() {
  document.getElementById('userDD').classList.remove('open');
  openModal('profileModal');
  try {
    const me = await api('/users/me');
    currentUser = {...currentUser, ...me};
    localStorage.setItem('sd_user', JSON.stringify(currentUser));
    document.getElementById('profileNickname').value = me.nickname||'';
    const avEl = document.getElementById('profileAvImg');
    if (me.avatar) { avEl.innerHTML=`<img src="${escH(me.avatar)}" alt="">`; }
    else { avEl.innerHTML = (me.nickname||me.username)[0].toUpperCase(); avEl.style.background='var(--accent)'; }
    const statusMap = {approved:'',pending:'<span class="avatar-status-pending">头像审核中...</span>',rejected:'<span class="avatar-status-rejected">头像审核未通过，请重新上传</span>'};
    document.getElementById('avatarStatusText').innerHTML = statusMap[me.avatar_status]||'';
  } catch(e){}
}

async function uploadAvatar(input) {
  const file = input.files[0]; if (!file) return; input.value='';
  const formData = new FormData(); formData.append('image', file);
  showToast('上传中...','info');
  try {
    const res = await fetch('/api/upload/image',{method:'POST',headers:{'Authorization':'Bearer '+token},body:formData});
    const data = await res.json();
    if (!res.ok) throw new Error(data.error||'上传失败');
    await api('/users/me/avatar',{method:'POST',body:{avatar_url:data.url}});
    document.getElementById('profileAvImg').innerHTML=`<img src="${escH(data.url)}" alt="">`;
    document.getElementById('avatarStatusText').innerHTML='<span class="avatar-status-pending">审核中，GM通过后生效</span>';
    showToast('头像已提交，等待GM审核','info');
  } catch(e) { showToast(e.message,'error'); }
}

async function saveProfile() {
  const nickname = document.getElementById('profileNickname').value.trim();
  const err=document.getElementById('profileErr'), ok=document.getElementById('profileOk');
  try {
    await api('/users/me',{method:'PUT',body:{nickname}});
    currentUser.nickname = nickname;
    localStorage.setItem('sd_user',JSON.stringify(currentUser));
    updateAuthUI();
    ok.textContent='保存成功 ✓'; err.textContent='';
    setTimeout(()=>{ ok.textContent=''; closeModal('profileModal'); }, 1500);
  } catch(e) { err.textContent=e.message; }
}

// ─── INBOX ────────────────────────────────────────────────────────────────
async function pollInboxUnread() {
  clearInterval(window._inboxTimer);
  await refreshInboxBadge();
  window._inboxTimer = setInterval(refreshInboxBadge, 30000);
}
async function refreshInboxBadge() {
  if (!currentUser) return;
  try {
    const data = await api('/messages/mine/unread');
    const badge = document.getElementById('inboxBadge');
    const label = fmtBadge(data.count);
    if (label) { badge.textContent=label; badge.style.display='flex'; }
    else badge.style.display='none';
  } catch{}
}
async function openInbox() {
  document.getElementById('userDD').classList.remove('open');
  document.getElementById('inboxPanel').classList.add('open');
  document.getElementById('inboxMask').classList.add('open');
  document.body.style.overflow='hidden';
  await loadInboxList();
}
function closeInbox() {
  document.getElementById('inboxPanel').classList.remove('open');
  document.getElementById('chatPanel').classList.remove('open');
  document.getElementById('inboxMask').classList.remove('open');
  document.body.style.overflow='';
  currentChatId=null; pendingImgUrl=null;
}
async function loadInboxList() {
  const list=document.getElementById('inboxList');
  list.innerHTML='<div class="inbox-empty">加载中...</div>';
  try {
    const topics = await api('/messages/mine');
    if (!topics.length) { list.innerHTML='<div class="inbox-empty">还没有消息<br><span style="font-size:12px;margin-top:8px;display:block">提交建议后在这里跟GM聊天</span></div>'; return; }
    list.innerHTML = topics.map(t=>{
      const last = t.replies&&t.replies.length ? t.replies[t.replies.length-1] : null;
      const preview = last ? (last.image_url?'[图片]':last.content) : t.content;
      const hasUnread = t.unread>0;
      return `<div class="inbox-topic ${hasUnread?'has-unread':''}" onclick="openChat(${t.id},'${escH(t.type)}')">
        <div class="it-top">
          <span class="it-tag">${escH(t.type)}</span>
          <span class="it-time">${t.created_at}</span>
          ${hasUnread?`<span class="it-badge">${fmtBadge(t.unread)}</span>`:''}
        </div>
        <div class="it-preview ${hasUnread?'bold':''}">${escH(preview)}</div>
      </div>`;
    }).join('');
  } catch(e) { list.innerHTML='<div class="inbox-empty">加载失败</div>'; }
}
async function readAll() {
  try {
    await api('/messages/mine/read-all',{method:'POST'});
    document.querySelectorAll('.inbox-topic.has-unread').forEach(el=>el.classList.remove('has-unread'));
    document.querySelectorAll('.it-badge').forEach(el=>el.remove());
    document.querySelectorAll('.it-preview').forEach(el=>el.classList.remove('bold'));
    refreshInboxBadge();
  } catch{}
}

// ─── CHAT ─────────────────────────────────────────────────────────────────
async function openChat(id, type) {
  currentChatId=id;
  document.getElementById('chatTitle').textContent=type;
  document.getElementById('chatSub').textContent='与GM的对话';
  document.getElementById('chatPanel').classList.add('open');
  document.getElementById('chatInput').value='';
  pendingImgUrl=null; document.getElementById('imgPreview').style.display='none';
  await loadChatMsgs(id);
  try { await api('/messages/'+id+'/read',{method:'POST'}); refreshInboxBadge(); } catch{}
}
function closeChat() { document.getElementById('chatPanel').classList.remove('open'); currentChatId=null; loadInboxList(); }

async function loadChatMsgs(id) {
  const box=document.getElementById('chatMsgs');
  box.innerHTML='<div style="text-align:center;color:var(--text2);padding:20px;font-size:13px">加载中...</div>';
  try {
    const data = await api('/messages/'+id);
    const replies = data.replies||[];
    if (!replies.length) { box.innerHTML='<div style="text-align:center;color:var(--text2);padding:20px;font-size:13px">暂无消息</div>'; return; }
    box.innerHTML = replies.map(r=>{
      const isMe = r.role==='user';
      const displayName = r.nickname||r.sender;
      const avHtml = r.avatar ? `<img src="${escH(r.avatar)}" alt="">` : displayName[0].toUpperCase();
      const avStyle = isMe ? 'background:var(--accent2)' : 'background:var(--accent)';
      const bubCls = isMe ? 'from-me' : 'from-gm';
      return `<div class="bubble-wrap ${isMe?'me':''}">
        <div class="bav ${isMe?'user':'gm'}" style="${!r.avatar?avStyle:''}">${avHtml}</div>
        <div class="bubble-body">
          <div class="bubble-name">${escH(displayName)}</div>
          <div class="bubble ${bubCls}">
            ${r.content?`<div>${escH(r.content)}</div>`:''}
            ${r.image_url?`<img src="${escH(r.image_url)}" onclick="openLightbox('${escH(r.image_url)}')" loading="lazy">`:''}
          </div>
          <div class="bubble-time">${r.created_at}</div>
        </div>
      </div>`;
    }).join('');
    box.scrollTop=box.scrollHeight;
  } catch(e) { box.innerHTML='<div style="text-align:center;color:#f44;padding:20px;font-size:13px">加载失败</div>'; }
}

async function sendChatMsg() {
  if (!currentChatId) return;
  const input=document.getElementById('chatInput');
  const content=input.value.trim(), imageUrl=pendingImgUrl;
  if (!content&&!imageUrl) return;
  const btn=document.getElementById('chatSendBtn'); btn.disabled=true;
  try {
    await api('/messages/'+currentChatId+'/reply-user',{method:'POST',body:{content,image_url:imageUrl}});
    input.value=''; pendingImgUrl=null; document.getElementById('imgPreview').style.display='none';
    await loadChatMsgs(currentChatId);
  } catch(e) { showToast(e.message,'error'); }
  btn.disabled=false;
}
async function handleImgSelect(input) {
  const file=input.files[0]; if (!file) return; input.value='';
  const fd=new FormData(); fd.append('image',file);
  showToast('上传中...','info');
  try {
    const res=await fetch('/api/upload/image',{method:'POST',headers:{'Authorization':'Bearer '+token},body:fd});
    const data=await res.json();
    if (!res.ok) throw new Error(data.error||'上传失败');
    pendingImgUrl=data.url;
    document.getElementById('imgPreviewImg').src=data.url;
    document.getElementById('imgPreview').style.display='block';
    showToast('图片已就绪，点发送');
  } catch(e) { showToast(e.message,'error'); }
}
function removeImg() { pendingImgUrl=null; document.getElementById('imgPreview').style.display='none'; }
function openLightbox(url) { document.getElementById('lightboxImg').src=url; document.getElementById('lightbox').classList.add('open'); }

// ─── SUGGEST ──────────────────────────────────────────────────────────────
function openSuggest() {
  if (!currentUser) { showToast('请先登录','error'); openModal('loginModal'); return; }
  document.getElementById('userDD').classList.remove('open');
  openModal('suggestModal');
}
async function doSuggest() {
  const type=document.getElementById('sType').value.trim(), content=document.getElementById('sContent').value.trim();
  const err=document.getElementById('sErr'), ok=document.getElementById('sOk');
  if (!type||!content) { err.textContent='请填写完整'; return; }
  try {
    await api('/messages',{method:'POST',body:{type,content}});
    err.textContent=''; ok.textContent='提交成功！GM会尽快处理 ✓';
    document.getElementById('sType').value=''; document.getElementById('sContent').value='';
    setTimeout(()=>{ ok.textContent=''; closeModal('suggestModal'); },2000);
  } catch(e) { err.textContent=e.message; }
}

// ─── EPISODE HELPERS ─────────────────────────────────────────────────────
// ─── CHARTS ───────────────────────────────────────────────────────────────
const STAT_COLORS = {
  plays: '#fb7299', likes: '#23ade5', coins: '#f4a728', 
  favorites: '#a259ff', shares: '#4caf50', comments: '#ff7043', 
  danmakus: '#26c6da', danmaku: '#26c6da',
  views: '#fb7299', fans: '#ffc107'
};
const STAT_LABELS = {
  plays: '播放', likes: '点赞', coins: '投币', favorites: '收藏',
  shares: '转发', comments: '评论', danmakus: '弹幕', danmaku: '弹幕',
  views: '播放', fans: '粉丝'
};

async function loadVideoChart(id) {
  const wrap = document.getElementById('chartWrap-'+id);
  if (!wrap) return;
  try {
    const data = await api('/stats/video/'+id);
    if (!data.length) { wrap.innerHTML = '<div style="padding:20px;color:var(--text2);text-align:center;font-size:13px">暂无历史数据，下次同步后开始记录</div>'; return; }
    wrap.innerHTML = renderChart(data, ['plays','likes','coins','favorites','shares','comments','danmakus']);
  } catch(e) { wrap.innerHTML = '<div style="padding:20px;color:#f44">加载失败</div>'; }
}

async function loadAuthorChart(name) {
  const wrap = document.getElementById('authorChartWrap');
  if (!wrap) return;
  try {
    const data = await api('/stats/author/'+encodeURIComponent(name));
    if (!data.length) { wrap.innerHTML = '<div style="padding:20px;color:var(--text2);text-align:center;font-size:13px">暂无历史数据</div>'; return; }
    // 把total_前缀去掉以适配通用渲染
    const mapped = data.map(d => ({
      sync_at: d.sync_at, plays: d.total_plays, likes: d.total_likes, coins: d.total_coins,
      favorites: d.total_favorites, shares: d.total_shares, comments: d.total_comments,
      danmakus: d.total_danmakus, fans: d.fans
    }));
    wrap.innerHTML = renderChart(mapped, ['plays','likes','coins','favorites','shares','comments','danmakus','fans']);
  } catch(e) { wrap.innerHTML = '<div style="padding:20px;color:#f44">加载失败</div>'; }
}

function renderChart(data, fields) {
  const W = 700, H = 280, padL = 50, padR = 20, padT = 20, padB = 40;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  
  // 默认显示哪些字段（只显示前3个，其他隐藏）
  let activeFields = fields.slice(0, 3);
  
  // 图例
  const legend = fields.map((f,i)=>{
    const color = STAT_COLORS[f] || '#888';
    const label = STAT_LABELS[f] || f;
    const active = activeFields.includes(f);
    return `<span class="chart-legend-item ${active?'active':''}" data-field="${f}" onclick="toggleChartField(this)">
      <span style="width:10px;height:10px;background:${color};border-radius:2px;display:inline-block;margin-right:5px;${active?'':'opacity:.3'}"></span>${label}
    </span>`;
  }).join('');
  
  // 存到全局供toggle使用
  window._chartData = {data, fields, W, H, padL, padR, padT, padB};
  return `
    <div class="chart-container">
      <div class="chart-legend">${legend}</div>
      <div class="chart-svg-wrap" id="chartSvgWrap">
        ${renderChartSVG(data, activeFields, W, H, padL, padR, padT, padB)}
      </div>
    </div>
  `;
}

function renderChartSVG(data, activeFields, W, H, padL, padR, padT, padB) {
  if (!data.length || !activeFields.length) return '<div style="padding:20px;text-align:center;color:var(--text2)">请选择至少一个数据项</div>';
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  
  // 计算每个字段的最大值，用于归一化
  let maxVal = 0;
  activeFields.forEach(f => {
    data.forEach(d => { if ((d[f]||0) > maxVal) maxVal = d[f]||0; });
  });
  if (maxVal === 0) maxVal = 1;
  
  const xStep = data.length > 1 ? innerW / (data.length-1) : 0;
  
  // Y轴刻度（5个）
  const yTicks = [];
  for (let i = 0; i <= 4; i++) {
    const v = maxVal * (4-i)/4;
    const y = padT + (innerH * i / 4);
    yTicks.push(`<line x1="${padL}" y1="${y}" x2="${padL+innerW}" y2="${y}" stroke="rgba(255,255,255,0.05)"/>
      <text x="${padL-5}" y="${y+4}" fill="#9999bb" font-size="10" text-anchor="end">${formatNum(v)}</text>`);
  }
  
  // X轴标签（最多5个）
  const xLabels = [];
  const labelStep = Math.max(1, Math.floor(data.length / 5));
  for (let i = 0; i < data.length; i += labelStep) {
    const x = padL + i * xStep;
    const date = data[i].sync_at.slice(5, 10);
    xLabels.push(`<text x="${x}" y="${padT+innerH+18}" fill="#9999bb" font-size="10" text-anchor="middle">${date}</text>`);
  }
  
  // 折线
  const lines = activeFields.map(f => {
    const color = STAT_COLORS[f] || '#888';
    const points = data.map((d,i) => {
      const x = padL + i * xStep;
      const y = padT + innerH - (innerH * (d[f]||0) / maxVal);
      return `${x},${y}`;
    }).join(' ');
    const dots = data.map((d,i) => {
      const x = padL + i * xStep;
      const y = padT + innerH - (innerH * (d[f]||0) / maxVal);
      return `<circle cx="${x}" cy="${y}" r="3" fill="${color}"><title>${STAT_LABELS[f]}: ${formatNum(d[f]||0)} (${d.sync_at})</title></circle>`;
    }).join('');
    return `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="2"/>${dots}`;
  }).join('');
  
  return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block">
    ${yTicks.join('')}
    ${xLabels.join('')}
    ${lines}
  </svg>`;
}

function formatNum(n) {
  if (n >= 100000000) return (n/100000000).toFixed(1)+'亿';
  if (n >= 10000) return (n/10000).toFixed(1)+'万';
  return Math.round(n);
}

function toggleChartField(el) {
  const field = el.dataset.field;
  el.classList.toggle('active');
  const dot = el.querySelector('span');
  dot.style.opacity = el.classList.contains('active') ? '1' : '.3';
  
  const cd = window._chartData;
  if (!cd) return;
  const activeFields = Array.from(document.querySelectorAll('.chart-legend-item.active')).map(e=>e.dataset.field);
  document.getElementById('chartSvgWrap').innerHTML = renderChartSVG(cd.data, activeFields, cd.W, cd.H, cd.padL, cd.padR, cd.padT, cd.padB);
}

function fmtDur(s) {
  if (!s) return '';
  const m=Math.floor(s/60), sec=s%60;
  return m+':'+(sec<10?'0':'')+sec;
}
function epCardHTML(e) {
  return `<div class="ep-card">
    <a href="https://www.bilibili.com/video/${e.bvid}" target="_blank" class="ep-cover" title="点击播放B站视频">
      ${e.cover?`<img src="${bimg(e.cover)}" loading="lazy">`:''}
      <span class="ep-num">第${e.ep_num}集</span>
      <span class="ep-dur">${fmtDur(e.duration)}</span>
      <div class="ep-play-overlay">▶</div>
    </a>
    <div class="ep-info" onclick="openEpisode(${e.video_id},${e.ep_num})" style="cursor:pointer" title="点击查看分集详情">
      <div class="ep-title">${escH(e.title)}</div>
      <div class="ep-stats">
        <span>▶ ${fmt(e.views)}</span>
        <span>👍 ${fmt(e.likes)}</span>
        <span>🪙 ${fmt(e.coins)}</span>
        <span>⭐ ${fmt(e.favorites)}</span>
        <span>↗ ${fmt(e.shares)}</span>
        <span>💬 ${fmt(e.comments)}</span>
        <span>弹 ${fmt(e.danmaku)}</span>
      </div>
    </div>
  </div>`;
}
function renderEpsPage(id) {
  const state = window._pages['eps_'+id];
  if (!state) return;
  const grid = document.getElementById('epGrid-'+id);
  const paginatorEl = document.getElementById('epPaginator-'+id);
  if (!grid || !paginatorEl) return;
  const slice = paginateSlice(state.data, state.page, state.pageSize);
  grid.innerHTML = slice.map(epCardHTML).join('');
  paginatorEl.innerHTML = renderPaginator({
    total: state.data.length, page: state.page, pageSize: state.pageSize, key: 'eps_'+id
  });
}

// ─── PLAYER ───────────────────────────────────────────────────────────────
let playlist = [], currentIdx = -1, audio = null;
function initPlayer() {
  audio = new Audio();
  audio.addEventListener('ended', ()=>playNext());
  audio.addEventListener('timeupdate', updateProgress);
  audio.addEventListener('error', ()=>{ playNext(); });
  loadPlaylist();
}
async function loadPlaylist() {
  try {
    const list = await api('/music');
    playlist = list;
    renderPlaylist();
    if (playlist.length) playTrack(0);
  } catch(e){}
}
function renderPlaylist() {
  const panel = document.getElementById('playlistPanel');
  if (!panel) return;
  // 保留原有 .pl-hd 头部，只替换列表内容
  let listEl = panel.querySelector('.pl-list');
  if (!listEl) {
    listEl = document.createElement('div');
    listEl.className = 'pl-list';
    panel.appendChild(listEl);
  }
  listEl.innerHTML = playlist.map((t,i)=>`
    <div class="pli ${i===currentIdx?'active':''}" onclick="playTrack(${i})">
      <div class="pli-cover">${t.cover?`<img src="${escH(t.cover)}" loading="lazy">`:'🎵'}</div>
      <div class="pli-info">
        <div class="pli-title">${escH(t.title)}</div>
        <div class="pli-artist">${escH(t.artist||'')}</div>
      </div>
      ${i===currentIdx?'<span class="pli-playing">♪</span>':''}
    </div>`).join('');
}
function playTrack(idx) {
  if (!playlist[idx]) return;
  currentIdx = idx;
  const t = playlist[idx];
  audio.src = t.url;
  audio.play().catch(()=>{});
  document.getElementById('playerTitle').textContent = t.title||'';
  document.getElementById('playerArtist').textContent = t.artist||'';
  document.getElementById('playerCover').innerHTML = t.cover?`<img src="${escH(t.cover)}">`:'🎵';
  document.getElementById('btnPlay').textContent = '⏸';
  renderPlaylist();
  loadLyrics(t);
}
function playNext() {
  if (!playlist.length) return;
  playTrack((currentIdx+1)%playlist.length);
}
function playPrev() {
  if (!playlist.length) return;
  playTrack((currentIdx-1+playlist.length)%playlist.length);
}
function togglePlay() {
  if (!audio) return;
  if (audio.paused) { audio.play(); document.getElementById('btnPlay').textContent='⏸'; }
  else { audio.pause(); document.getElementById('btnPlay').textContent='▶'; }
}
function updateProgress() {
  if (!audio||!audio.duration) return;
  if (_isDraggingSeek) return;  // 拖拽时不更新
  const pct = audio.currentTime/audio.duration*100;
  const bar = document.getElementById('progressFill');
  if (bar) bar.style.width = pct+'%';
  const cur = document.getElementById('playerTimeCur');
  const dur = document.getElementById('playerTimeDur');
  if (cur) cur.textContent = fmtTime(audio.currentTime);
  if (dur) dur.textContent = fmtTime(audio.duration);
}
function fmtTime(s) {
  if (!s||isNaN(s)) return '0:00';
  const m=Math.floor(s/60), sec=Math.floor(s%60);
  return m+':'+(sec<10?'0':'')+sec;
}
function seekTo(e) {
  if (!audio||!audio.duration) return;
  const bar = document.getElementById('playerProgress');
  if (!bar) return;
  const rect = bar.getBoundingClientRect();
  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  audio.currentTime = pct * audio.duration;
}

let _isDraggingSeek = false;
function startSeekDrag(e) {
  if (!audio || !audio.duration) return;
  e.preventDefault();
  _isDraggingSeek = true;
  const bar = document.getElementById('playerProgress');
  const fill = document.getElementById('progressFill');
  if (!bar) return;

  const updatePos = (clientX) => {
    const rect = bar.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    if (fill) fill.style.width = (pct * 100) + '%';
    return pct;
  };

  // mousedown 立即跳一次（实现"点击=跳转"）
  let lastPct = updatePos(e.clientX);

  const onMove = (ev) => {
    if (_isDraggingSeek) lastPct = updatePos(ev.clientX);
  };
  const onUp = () => {
    if (!_isDraggingSeek) return;
    audio.currentTime = lastPct * audio.duration;
    console.log('[seek] 跳到', (lastPct*100).toFixed(1), '% =', audio.currentTime.toFixed(2), 's');
    _isDraggingSeek = false;
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  };
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}
function setVolume(e) {
  if (!audio) return;
  audio.volume = e.target.value/100;
}
let _playMode = 'sequence'; // sequence / shuffle / single
function toggleMode() {
  const modes = ['sequence', 'shuffle', 'single'];
  const icons = { sequence: '🔁', shuffle: '🔀', single: '🔂' };
  const labels = { sequence: '顺序播放', shuffle: '随机播放', single: '单曲循环' };
  const idx = modes.indexOf(_playMode);
  _playMode = modes[(idx+1)%modes.length];
  const btn = document.getElementById('btnMode');
  if (btn) { btn.textContent = icons[_playMode]; btn.title = '播放模式: '+labels[_playMode]; }
}

let _isMuted = false, _lastVolume = 0.7;
function toggleMute() {
  if (!audio) return;
  if (_isMuted) {
    audio.volume = _lastVolume;
    _isMuted = false;
    const btn = document.getElementById('btnVol');
    if (btn) btn.textContent = '🔊';
    const slider = document.querySelector('#playerVol input');
    if (slider) slider.value = _lastVolume * 100;
  } else {
    _lastVolume = audio.volume;
    audio.volume = 0;
    _isMuted = true;
    const btn = document.getElementById('btnVol');
    if (btn) btn.textContent = '🔇';
    const slider = document.querySelector('#playerVol input');
    if (slider) slider.value = 0;
  }
}

function togglePlaylist() {
  document.getElementById('playlistPanel').classList.toggle('open');
}
function loadLyrics(t) {
  const el = document.getElementById('lyricsWrap');
  if (!el) return;
  if (!t.lyrics) { el.innerHTML='<div class="lyric-line">暂无歌词</div>'; return; }
  const lines = t.lyrics.split('\n').filter(l=>l.trim());
  el.innerHTML = lines.map(l=>`<div class="lyric-line">${escH(l)}</div>`).join('');
}
document.addEventListener('click', e => {
  if (!e.target.closest('#playlistPanel') && !e.target.closest('.player-list-btn'))
    document.getElementById('playlistPanel').classList.remove('open');
});

// ─── INIT ─────────────────────────────────────────────────────────────────
updateAuthUI();
// 解析 URL 恢复状态
const _params = new URLSearchParams(location.search);
const _initCat = _params.get('cat') || 'all';
const _initQ = _params.get('q') || '';
const _initPage = parseInt(_params.get('page')) || 1;
if (_initQ) document.getElementById('searchInput').value = _initQ;
loadCats().then(() => {
  // 切换分类
  if (_initCat !== 'all') {
    const el = document.querySelector(`.cat-item[onclick*="'${_initCat}'"]`);
    if (el) {
      document.querySelectorAll('.cat-item').forEach(i => i.classList.remove('active'));
      el.classList.add('active');
      currentCat = _initCat;
    }
  }
  // 加载卡片
  loadCards(_initCat, _initQ).then(() => {
    // 跳到指定页
    if (_initPage > 1 && window._pages?.cards) {
      goToPage('cards', _initPage);
    }
    // 更新标题
    if (_initQ) {
      const catLabel = document.querySelector('.cat-item.active')?.textContent.trim() || '全部';
      document.getElementById('sectionTitle').textContent = `🔍 "${_initQ}" 的结果（${catLabel}）`;
    }
  });
});
initPlayer();
// ─── 路由：URL ↔ 弹层状态同步 ───────────────────────
function applyRoute() {
  const path = decodeURIComponent(location.pathname);

  // 先关闭所有弹层
  document.getElementById('detailPage')?.classList.remove('open');
  document.getElementById('episodePage')?.classList.remove('open');
  document.getElementById('authorPage')?.classList.remove('open');
  document.body.style.overflow = '';
  document.title = '沙雕库 · 全网沙雕动画聚合';
  setFavicon(null);

  let m;
  // /video/22-蜉蝣/ep/3
  if (m = path.match(/^\/video\/(\d+)(?:-[^/]*)?\/ep\/(\d+)\/?$/)) {
    openDetail(parseInt(m[1]), {skipPush:true});
    setTimeout(() => openEpisode(parseInt(m[1]), parseInt(m[2]), {skipPush:true}), 50);
  }
  // /video/22-蜉蝣
  else if (m = path.match(/^\/video\/(\d+)(?:-.*)?$/)) {
    openDetail(parseInt(m[1]), {skipPush:true});
  }
  // /author/在下宁不凡
  else if (m = path.match(/^\/author\/(.+)$/)) {
    openAuthor(encodeURIComponent(m[1]), {skipPush:true});
  }
  // / 或其他 → 首页（什么也不做）
}

window.addEventListener('popstate', applyRoute);
window.addEventListener('DOMContentLoaded', applyRoute);

// 详情页跳作者主页（替换原来的 closeDetail();openAuthor() 链式调用）
function navigateToAuthor(nameEnc) {
  const name = decodeURIComponent(nameEnc);
  history.pushState(null, '', `/author/${encodeURIComponent(name)}`);
  document.getElementById('detailPage')?.classList.remove('open');
  openAuthor(nameEnc, {skipPush: true});
}

// 分集页返回合集（替换原来的 closeEpisode();openDetail() 链式调用）
function navigateToVideo(id) {
  history.pushState(null, '', `/video/${id}`);
  document.getElementById('episodePage')?.classList.remove('open');
  openDetail(id, {skipPush: true});
}

// ─── 通用分页器 ───────────────────────────────────────────
// 分页状态全局存储
window._pages = window._pages || {};

// 渲染分页器 HTML
// opts: { total, page, pageSize, key }
function renderPaginator(opts) {
  const { total, page, pageSize, key } = opts;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const isOnePage = totalPages <= 1;
  const isMobile = window.innerWidth < 768;

  // 计算 5 个连续数字的窗口（当前页尽量在中间）
  const WINDOW = 5;
  let start, end;
  if (totalPages <= WINDOW) {
    start = 1; end = totalPages;
  } else {
    start = Math.max(1, page - 2);
    end = start + WINDOW - 1;
    if (end > totalPages) {
      end = totalPages;
      start = end - WINDOW + 1;
    }
  }
  const pageBtns = [];
  if (!isMobile) {
    for (let p = start; p <= end; p++) {
      pageBtns.push(`<button class="pg-num ${p===page?'active':''}" onclick="goToPage('${key}', ${p})">${p}</button>`);
    }
  }

  const firstDisabled = page <= 1 ? 'disabled' : '';
  const prevDisabled = page <= 1 ? 'disabled' : '';
  const nextDisabled = page >= totalPages ? 'disabled' : '';
  const lastDisabled = page >= totalPages ? 'disabled' : '';
  const jumpDisabled = isOnePage ? 'disabled' : '';

  return `
    <div class="paginator ${isMobile?'pg-mobile':'pg-desktop'}">
      <button class="pg-arrow" ${firstDisabled} onclick="goToPage('${key}', 1)" title="首页">«</button>
      <button class="pg-arrow" ${prevDisabled} onclick="goToPage('${key}', ${page-1})" title="上一页">‹</button>
      ${isMobile ? '' : pageBtns.join('')}
      <button class="pg-arrow" ${nextDisabled} onclick="goToPage('${key}', ${page+1})" title="下一页">›</button>
      <button class="pg-arrow" ${lastDisabled} onclick="goToPage('${key}', ${totalPages})" title="尾页">»</button>
      <span class="pg-jump">
        跳转
        <input type="number" class="pg-jump-input" id="pg-jump-${key}" min="1" max="${totalPages}" placeholder="页" value="${page}" ${jumpDisabled} onfocus="this.select()" onkeydown="if(event.key==='Enter')doJump('${key}')">
        <button class="pg-jump-btn" ${jumpDisabled} onclick="doJump('${key}')">Go</button>
      </span>
      <span class="pg-info">${page} / ${totalPages}</span>
    </div>
  `;
}

// 翻页（通用回调）
function goToPage(key, page) {
  const state = window._pages[key];
  if (!state) return;
  const totalPages = Math.max(1, Math.ceil(state.data.length / state.pageSize));
  if (page < 1 || page > totalPages) return;
  state.page = page;
  if (typeof state.render === 'function') state.render();
  // 仅首页卡片同步 URL
  if (key === 'cards' && typeof syncCardsURL === 'function') syncCardsURL();
  // 翻页不自动滚动
}

// 跳转输入框处理
function doJump(key) {
  const state = window._pages[key];
  if (!state) return;
  const input = document.getElementById('pg-jump-'+key);
  if (!input) return;
  const raw = input.value.trim();
  const v = parseInt(raw);
  const totalPages = Math.max(1, Math.ceil(state.data.length / state.pageSize));
  // 输入空 / 非数字 → 摇晃提示（不知道用户意图，不能瞎跳）
  if (!raw || !Number.isInteger(v)) {
    input.classList.add('pg-shake');
    setTimeout(() => input.classList.remove('pg-shake'), 400);
    return;
  }
  // 越界自动夹到边界
  let target = v;
  if (target < 1) target = 1;
  if (target > totalPages) target = totalPages;
  // 保留输入框值（夹紧后），方便用户重复点 Go 或微调
  input.value = String(target);
  goToPage(key, target);
}

// 切片当前页数据
function paginateSlice(data, page, pageSize) {
  const start = (page - 1) * pageSize;
  return data.slice(start, start + pageSize);
}

// 返回主页：跳到 / 并关闭所有弹层（applyRoute 会自动收尾）
function goHome() {
  history.pushState(null, '', '/');
  applyRoute();
}


// Logo 点击：当前在首页 → 不做事，其他页面 → 新标签打开主页
function goLogo() {
  if (location.pathname === '/' || location.pathname === '') {
    return;
  }
  window.open('/', '_blank');
}

// 首页加载或路由切换到 / 时，如果 URL 有 ?q=xxx，自动填充搜索框 + 触发搜索
function _checkSearchQuery() {
  const params = new URLSearchParams(location.search);
  const q = params.get('q');
  if (q && (location.pathname === '/' || location.pathname === '')) {
    setTimeout(() => {
      const input = document.getElementById('searchInput');
      if (input) {
        input.value = q;
        if (typeof doSearch === 'function') doSearch();
      }
    }, 100);
  }
}

// 首次加载（DOMContentLoaded 已经被 applyRoute 监听了，但 q 参数处理需要单独触发）
window.addEventListener('DOMContentLoaded', _checkSearchQuery);

// 路由变化时也检查（applyRoute 已经监听了 popstate，我们额外加一层）
const _origApplyRoute2 = applyRoute;
applyRoute = function() {
  _origApplyRoute2();
  _checkSearchQuery();
};
window.addEventListener('popstate', applyRoute);


// ─── 首页悬浮翻页按钮 ───────────────────────────────────
(function initFlipBtns() {
  // 创建左右按钮
  const btnL = document.createElement('button');
  const btnR = document.createElement('button');
  btnL.className = 'flip-btn flip-btn-l';
  btnR.className = 'flip-btn flip-btn-r';
  btnL.innerHTML = '&#8249;';
  btnR.innerHTML = '&#8250;';
  btnL.title = '上一页 (A / ←)';
  btnR.title = '下一页 (D / →)';
  document.body.appendChild(btnL);
  document.body.appendChild(btnR);

  function updateFlipBtns() {
    const st = window._pages?.cards;
    const isHome = !document.getElementById('detailPage')?.classList.contains('open')
      && !document.getElementById('episodePage')?.classList.contains('open')
      && !document.getElementById('authorPage')?.classList.contains('open');

    // 只在首页可见
    const show = isHome && st && st.data.length > st.pageSize;
    btnL.style.display = show ? 'flex' : 'none';
    btnR.style.display = show ? 'flex' : 'none';
    if (!show) return;

    const totalPages = Math.ceil(st.data.length / st.pageSize);
    btnL.disabled = st.page <= 1;
    btnR.disabled = st.page >= totalPages;
    btnL.classList.toggle('flip-btn-disabled', st.page <= 1);
    btnR.classList.toggle('flip-btn-disabled', st.page >= totalPages);
  }

  function flipCardPage(dir) {
    const st = window._pages?.cards;
    if (!st) return;
    const totalPages = Math.ceil(st.data.length / st.pageSize);
    const next = st.page + dir;
    if (next < 1 || next > totalPages) return;
    goToPage('cards', next);
    updateFlipBtns();
  }

  btnL.addEventListener('click', () => flipCardPage(-1));
  btnR.addEventListener('click', () => flipCardPage(1));

  // 键盘翻页（输入框聚焦时不响应）
  document.addEventListener('keydown', e => {
    const tag = document.activeElement?.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
      e.preventDefault();
      flipCardPage(-1);
    } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
      e.preventDefault();
      flipCardPage(1);
    } else if (e.key === 'w' || e.key === 'W') {
      e.preventDefault();
      flipCardPage(-1);
    } else if (e.key === 's' || e.key === 'S') {
      e.preventDefault();
      flipCardPage(1);
    }
  });

  // 监听路由变化和渲染后更新按钮状态
  const origRender = window.renderCardsPage;
  window.renderCardsPage = function() {
    if (typeof origRender === 'function') origRender();
    setTimeout(updateFlipBtns, 50);
  };

  // 弹层开关时更新
  const observer = new MutationObserver(updateFlipBtns);
  ['detailPage','episodePage','authorPage'].forEach(id => {
    const el = document.getElementById(id);
    if (el) observer.observe(el, { attributes: true, attributeFilter: ['class'] });
  });

  // 初始化
  updateFlipBtns();
  window._updateFlipBtns = updateFlipBtns;

  // W/S 键翻页已集成到键盘监听
})();


// ─── 公告条轮播 ────────────────────────────
async function initAnnounceBar() {
  try {
    const list = await fetch('/api/announcements').then(r => r.json());
    if (!list || !list.length) return;

    const bar = document.getElementById('announceBar');
    const item = document.getElementById('announceContent');
    if (!bar || !item) return;

    bar.style.display = 'flex';

    let idx = 0;
    const render = () => {
      const a = list[idx];
      item.classList.add('changing');
      setTimeout(() => {
        item.textContent = a.content;
        if (a.link) { item.href = a.link; item.style.cursor = 'pointer'; }
        else { item.removeAttribute('href'); item.style.cursor = 'default'; }
        item.classList.remove('changing');
      }, 400);
      idx = (idx + 1) % list.length;
    };

    // 立即显示第一条（不带过渡）
    item.textContent = list[0].content;
    if (list[0].link) { item.href = list[0].link; item.style.cursor = 'pointer'; }
    idx = 1 % list.length;

    // 多条才轮播
    if (list.length > 1) {
      setInterval(render, 5000);
    }
  } catch(e) { console.error('公告加载失败:', e); }
}
// 页面加载完成后初始化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initAnnounceBar);
} else {
  initAnnounceBar();
}
