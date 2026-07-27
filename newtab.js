"use strict";

// ---------- storage ----------
function getCfg() {
  return new Promise((res) => chrome.storage.local.get(["todoistToken", "ghUser", "ghToken", "vpsUrl", "city"], res));
}

// ---------- helpers ----------
const $ = (id) => document.getElementById(id);
function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

// ---------- clock ----------
const WK = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
function greeting(h) {
  if (h < 5) return "夜深了";
  if (h < 9) return "早上好";
  if (h < 12) return "上午好";
  if (h < 14) return "中午好";
  if (h < 18) return "下午好";
  if (h < 23) return "晚上好";
  return "夜深了";
}
function tick() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  $("clock").firstChild.nodeValue = `${p(d.getHours())}:${p(d.getMinutes())}`;
  $("secs").textContent = `:${p(d.getSeconds())}`;
  $("greeting").textContent = greeting(d.getHours());
  $("date").textContent = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 · ${WK[d.getDay()]}`;
}

// ---------- Bilibili ----------
async function biliJson(url) {
  const r = await fetch(url, { credentials: "include", headers: { Accept: "application/json" } });
  return r.json();
}
async function loadBili() {
  const body = $("bili-body");
  try {
    const nav = await biliJson("https://api.bilibili.com/x/web-interface/nav");
    if (!nav?.data?.isLogin) {
      body.innerHTML = `<p class="notice">未检测到 B 站登录。请先在浏览器里 <a href="https://www.bilibili.com" target="_blank" rel="noreferrer">登录 bilibili.com</a>，再刷新本页。</p>`;
      return;
    }
    const mid = nav.data.mid;
    $("bili-user").textContent = nav.data.uname || `uid ${mid}`;
    const fj = await biliJson(`https://api.bilibili.com/x/v3/fav/folder/created/list-all?up_mid=${mid}`);
    const folders = fj?.data?.list || [];
    if (!folders.length) {
      body.innerHTML = `<p class="notice">没有找到收藏夹。</p>`;
      return;
    }
    body.innerHTML = "";
    folders.forEach((f, i) => {
      const wrap = el("div", "folder");
      const head = el("button", "folder-head", `<span class="caret">▶</span><span>${esc(f.title)}</span><span class="count">${f.media_count}</span>`);
      const items = el("div", "folder-items");
      items.style.display = "none";
      let loaded = false;
      head.addEventListener("click", async () => {
        const open = items.style.display !== "none";
        items.style.display = open ? "none" : "grid";
        head.classList.toggle("open", !open);
        if (!open && !loaded) {
          loaded = true;
          items.innerHTML = `<p class="muted small">加载中…</p>`;
          try {
            const rj = await biliJson(`https://api.bilibili.com/x/v3/fav/resource/list?media_id=${f.id}&pn=1&ps=30&platform=web`);
            const medias = rj?.data?.medias || [];
            items.innerHTML = "";
            if (!medias.length) items.innerHTML = `<p class="muted small">空</p>`;
            medias.forEach((m) => {
              const a = el("a", "media");
              a.href = m.bvid ? `https://www.bilibili.com/video/${m.bvid}` : m.link || "#";
              a.target = "_blank";
              a.rel = "noreferrer";
              a.innerHTML = `<img referrerpolicy="no-referrer" src="${esc((m.cover || "").replace(/^http:/, "https:"))}" alt=""><span class="t">${esc(m.title)}</span>`;
              items.appendChild(a);
            });
          } catch {
            items.innerHTML = `<p class="muted small">加载失败</p>`;
          }
        }
      });
      wrap.appendChild(head);
      wrap.appendChild(items);
      body.appendChild(wrap);
      if (i === 0) head.click(); // auto-open the first folder
    });
  } catch {
    body.innerHTML = `<p class="notice">B 站接口请求失败（检查插件 host 权限与登录状态）。</p>`;
  }
}

// ---------- Todoist ----------
async function loadTodos(token) {
  const body = $("todo-body");
  if (!token) {
    body.innerHTML = `<p class="notice">未配置 Todoist。到 <a href="options.html" target="_blank">设置</a> 填入 API Token。</p>`;
    return;
  }
  body.innerHTML = `<p class="muted small">加载中…</p>`;
  try {
    const r = await fetch("https://api.todoist.com/rest/v2/tasks?filter=" + encodeURIComponent("today | overdue"), {
      headers: { Authorization: "Bearer " + token },
    });
    if (!r.ok) throw new Error();
    const tasks = await r.json();
    if (!tasks.length) {
      body.innerHTML = `<p class="muted small">今天没有待办 🎉</p>`;
      return;
    }
    body.innerHTML = "";
    tasks.forEach((t) => {
      const b = el("button", "todo");
      b.innerHTML = `<span class="check"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></span><span class="truncate todo-text">${esc(t.content)}</span>${t.due?.string ? `<span class="todo-date">${esc(t.due.string)}</span>` : ""}`;
      b.addEventListener("click", async () => {
        if (b.classList.contains("done")) return;
        b.classList.add("done");
        b.querySelector(".check").classList.add("done");
        setTimeout(async () => {
          try {
            await fetch(`https://api.todoist.com/rest/v2/tasks/${t.id}/close`, { method: "POST", headers: { Authorization: "Bearer " + token } });
          } catch {}
          b.remove();
        }, 300);
      });
      body.appendChild(b);
    });
  } catch {
    body.innerHTML = `<p class="notice">Todoist 加载失败（Token 是否正确？）。</p>`;
  }
}

// ---------- GitHub star (with categories) ----------
const gh = { repos: [], cats: [], map: {}, active: "全部", UNCAT: "未分类" };
function ghSave() { chrome.storage.local.set({ ghCats: gh.cats, ghMap: gh.map }); }
async function loadGitHub(user, token) {
  const body = $("gh-body");
  const headers = { Accept: "application/vnd.github+json" };
  let url;
  if (token) { headers.Authorization = "Bearer " + token; url = "https://api.github.com/user/starred?per_page=100"; if (user) $("gh-user").textContent = user; }
  else if (user) { url = `https://api.github.com/users/${encodeURIComponent(user)}/starred?per_page=100`; $("gh-user").textContent = user; }
  else { body.innerHTML = `<p class="notice">未配置 GitHub。到 <a href="options.html" target="_blank">设置</a> 填用户名（可选 Token）。</p>`; return; }
  body.innerHTML = `<p class="muted small">加载中…</p>`;
  const stored = await new Promise((r) => chrome.storage.local.get(["ghCats", "ghMap"], r));
  gh.cats = stored.ghCats || []; gh.map = stored.ghMap || {};
  try {
    const r = await fetch(url, { headers });
    if (!r.ok) throw new Error();
    gh.repos = await r.json();
    renderGh();
  } catch {
    body.innerHTML = `<p class="notice">GitHub 加载失败（频率限制或 Token 无效）。</p>`;
  }
}
function renderGh() {
  const body = $("gh-body");
  body.innerHTML = "";
  // tabs
  const tabs = el("div", "gh-tabs");
  const counts = { 全部: gh.repos.length, [gh.UNCAT]: 0 };
  gh.cats.forEach((c) => (counts[c] = 0));
  gh.repos.forEach((rp) => { const c = gh.map[rp.full_name]; if (c && gh.cats.includes(c)) counts[c]++; else counts[gh.UNCAT]++; });
  ["全部", gh.UNCAT, ...gh.cats].forEach((t) => {
    const b = el("button", "gh-tab" + (gh.active === t ? " on" : ""), `${t} <span class="dim">${counts[t] || 0}</span>${t !== "全部" && t !== gh.UNCAT ? ' <span class="x">✕</span>' : ""}`);
    b.addEventListener("click", (e) => {
      if (e.target.classList.contains("x")) { gh.cats = gh.cats.filter((c) => c !== t); for (const k in gh.map) if (gh.map[k] === t) delete gh.map[k]; if (gh.active === t) gh.active = "全部"; ghSave(); renderGh(); return; }
      gh.active = t; renderGh();
    });
    tabs.appendChild(b);
  });
  const addBtn = el("button", "gh-tab dash", "＋ 新建分类");
  addBtn.addEventListener("click", () => {
    const n = prompt("分类名称");
    if (n && n.trim() && !gh.cats.includes(n.trim()) && n.trim() !== gh.UNCAT) { gh.cats.push(n.trim()); gh.active = n.trim(); ghSave(); renderGh(); }
  });
  tabs.appendChild(addBtn);
  body.appendChild(tabs);
  // list
  const shown = gh.active === "全部" ? gh.repos : gh.active === gh.UNCAT ? gh.repos.filter((rp) => !gh.map[rp.full_name] || !gh.cats.includes(gh.map[rp.full_name])) : gh.repos.filter((rp) => gh.map[rp.full_name] === gh.active);
  if (!shown.length) { body.appendChild(el("p", "muted small", "这个分类下没有仓库。")); return; }
  const grid = el("div", "repos");
  shown.forEach((rp) => {
    const card = el("div", "repo");
    const cur = gh.map[rp.full_name] && gh.cats.includes(gh.map[rp.full_name]) ? gh.map[rp.full_name] : "";
    card.innerHTML =
      `<a href="${rp.html_url}" target="_blank" rel="noreferrer" class="name"><span class="owner">${esc(rp.owner?.login)}/</span>${esc(rp.name)}</a>` +
      (rp.description ? `<p class="desc">${esc(rp.description)}</p>` : "") +
      `<div class="meta"><span>${rp.language ? esc(rp.language) : ""}</span><span>★ ${(rp.stargazers_count ?? 0).toLocaleString()}</span><select class="gh-sel"><option value="">${gh.UNCAT}</option>${gh.cats.map((c) => `<option value="${esc(c)}"${c === cur ? " selected" : ""}>${esc(c)}</option>`).join("")}</select></div>`;
    card.querySelector(".gh-sel").addEventListener("change", (e) => { const v = e.target.value; if (v) gh.map[rp.full_name] = v; else delete gh.map[rp.full_name]; ghSave(); renderGh(); });
    grid.appendChild(card);
  });
  body.appendChild(grid);
}

// ---------- VPS probe ----------
function bytes(n) {
  if (!n) return "0";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0, v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)}${u[i]}`;
}
function uptimeStr(s) {
  if (!s) return "-";
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}天 ${h}小时`;
  if (h > 0) return `${h}小时 ${m}分`;
  return `${m}分`;
}
function gColor(p) { return p >= 85 ? "#ef4444" : p >= 60 ? "#f59e0b" : "#34d399"; }
function gauge(label, pct, sub) {
  const c = gColor(pct);
  return `<div class="gauge"><div class="g-top"><span class="g-label">${label}</span><span class="g-pct" style="color:${c}">${pct.toFixed(0)}%</span></div><div class="g-track"><div class="g-fill" style="width:${Math.min(100, pct)}%;background:${c}"></div></div><div class="g-sub">${sub}</div></div>`;
}
async function loadVps(url) {
  const body = $("vps-body");
  if (!url) { body.innerHTML = `<p class="notice">未配置 VPS。到 <a href="options.html" target="_blank">设置</a> 填探针地址（返回 stats JSON 的 HTTPS 接口）。</p>`; return; }
  try {
    const r = await fetch(url, { headers: { Accept: "application/json" } });
    const d = await r.json();
    if (d.offline || !d.mem) { body.innerHTML = `<p class="notice">探针离线（/stats 未开放或代理未运行）。</p>`; return; }
    if (d.hostname) $("vps-host").textContent = d.hostname;
    const loadPct = d.load && d.cpu_count ? Math.min(100, (d.load[0] / d.cpu_count) * 100) : 0;
    body.innerHTML = `<div class="gauges">${
      gauge("CPU 负载", loadPct, `load ${d.load?.[0]?.toFixed(2) ?? "-"} · ${d.cpu_count ?? "-"} 核`)
    }${gauge("内存", d.mem?.percent ?? 0, `${bytes(d.mem?.used)} / ${bytes(d.mem?.total)}`)
    }${gauge("磁盘", d.disk?.percent ?? 0, `${bytes(d.disk?.used)} / ${bytes(d.disk?.total)}`)
    }<div class="gauge"><div class="g-top"><span class="g-label">在线时长</span><span>🟢</span></div><div class="g-sub" style="font-size:15px;font-weight:700;color:var(--heading);margin-top:6px">${uptimeStr(d.uptime)}</div></div></div>`;
  } catch {
    body.innerHTML = `<p class="notice">探针连接失败（检查 VPS 地址 / worker 代理）。</p>`;
  }
}

// ---------- browser: top sites + bookmarks ----------
function favi(url) {
  try {
    return chrome.runtime.getURL("_favicon/?pageUrl=" + encodeURIComponent(url) + "&size=32");
  } catch {
    return "";
  }
}
function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

function loadTopSites() {
  const body = $("top-body");
  if (!chrome.topSites) { body.innerHTML = `<p class="muted small">不可用</p>`; return; }
  chrome.topSites.get((sites) => {
    if (!sites || !sites.length) { body.innerHTML = `<p class="muted small">暂无常用网站</p>`; return; }
    body.innerHTML = "";
    sites.slice(0, 14).forEach((s) => {
      const a = el("a", "shortcut");
      a.href = s.url;
      a.title = s.title || s.url;
      a.innerHTML = `<img src="${favi(s.url)}" alt=""><span>${esc(s.title || hostOf(s.url))}</span>`;
      body.appendChild(a);
    });
  });
}

function bmLink(l) {
  const a = el("a", "bm-link");
  a.href = l.url;
  a.title = l.title || l.url;
  a.innerHTML = `<img src="${favi(l.url)}" alt=""><span class="truncate" style="max-width:180px">${esc(l.title || hostOf(l.url))}</span>`;
  return a;
}
function flattenLinks(node, out) {
  for (const c of node.children || []) {
    if (c.url) out.push(c);
    else if (c.children) flattenLinks(c, out);
  }
  return out;
}
function bmFolder(f) {
  const wrap = el("div", "bm-folder");
  const items = flattenLinks(f, []);
  const head = el("button", "bm-fhead", `<span class="caret">▶</span><span>${esc(f.title)}</span><span class="count">${items.length}</span>`);
  const box = el("div", "bm-fitems");
  box.style.display = "none";
  let filled = false;
  head.addEventListener("click", () => {
    const open = box.style.display !== "none";
    box.style.display = open ? "none" : "flex";
    head.classList.toggle("open", !open);
    if (!open && !filled) { filled = true; items.slice(0, 80).forEach((l) => box.appendChild(bmLink(l))); }
  });
  wrap.appendChild(head);
  wrap.appendChild(box);
  return wrap;
}
function loadBookmarks() {
  const body = $("bm-body");
  if (!chrome.bookmarks) { body.innerHTML = `<p class="muted small">不可用</p>`; return; }
  chrome.bookmarks.getTree((tree) => {
    const root = tree[0];
    const bar = (root.children || []).find((c) => c.id === "1") || (root.children || [])[0];
    if (!bar || !bar.children || !bar.children.length) { body.innerHTML = `<p class="muted small">书签栏为空</p>`; return; }
    body.innerHTML = "";
    const links = bar.children.filter((c) => c.url);
    const folders = bar.children.filter((c) => !c.url && c.children);
    if (links.length) {
      const flat = el("div", "bm-flat");
      links.forEach((l) => flat.appendChild(bmLink(l)));
      body.appendChild(flat);
    }
    folders.forEach((f) => body.appendChild(bmFolder(f)));
  });
}

// ---------- search ----------
function initSearch() {
  const form = $("search"), input = $("search-input");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    const isUrl = /^https?:\/\//i.test(q) || (!q.includes(" ") && /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(q));
    location.href = isUrl ? (/^https?:/i.test(q) ? q : "https://" + q) : "https://www.bing.com/search?q=" + encodeURIComponent(q);
  });
}

// ---------- weather ----------
function wxInfo(c) {
  if (c === 0) return { emoji: "☀️", label: "晴" };
  if (c <= 2) return { emoji: "🌤️", label: "少云" };
  if (c === 3) return { emoji: "☁️", label: "多云" };
  if (c === 45 || c === 48) return { emoji: "🌫️", label: "雾" };
  if (c >= 51 && c <= 57) return { emoji: "🌦️", label: "毛毛雨" };
  if (c >= 61 && c <= 67) return { emoji: "🌧️", label: "雨" };
  if (c >= 71 && c <= 77) return { emoji: "🌨️", label: "雪" };
  if (c >= 80 && c <= 82) return { emoji: "🌧️", label: "阵雨" };
  if (c >= 85 && c <= 86) return { emoji: "🌨️", label: "阵雪" };
  if (c >= 95) return { emoji: "⛈️", label: "雷雨" };
  return { emoji: "🌡️", label: "—" };
}
async function loadWeather(city) {
  const body = $("weather-body");
  if (!city) {
    body.innerHTML = `<p class="notice">未设置城市。到 <a href="options.html" target="_blank">设置</a> 填写城市名（如 武汉 / Tokyo）。</p>`;
    return;
  }
  body.innerHTML = `<p class="muted small">加载中…</p>`;
  try {
    const g = await (await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=zh&format=json`)).json();
    const loc = g.results && g.results[0];
    if (!loc) { body.innerHTML = `<p class="notice">找不到城市「${esc(city)}」。</p>`; return; }
    const t = $("wx-title"); if (t) t.textContent = `${loc.name || city} · 天气`;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&current=temperature_2m,weather_code&hourly=temperature_2m,weather_code,precipitation_probability&daily=temperature_2m_max,temperature_2m_min,weather_code&forecast_days=3&timezone=auto`;
    const d = await (await fetch(url)).json();
    const cur = wxInfo(d.current.weather_code);
    const times = d.hourly.time, nowMs = Date.now();
    let start = times.findIndex((t) => new Date(t).getTime() >= nowMs);
    if (start < 0) start = 0;
    let hours = "";
    for (let i = start; i < Math.min(start + 5, times.length); i++) {
      hours += `<div class="wx-h"><span class="hh">${i === start ? "现在" : new Date(times[i]).getHours() + "时"}</span><span class="he">${wxInfo(d.hourly.weather_code[i]).emoji}</span><span class="ht">${Math.round(d.hourly.temperature_2m[i])}°</span></div>`;
    }
    let rain = "未来 12 小时暂无降水 ☂️";
    for (let i = start; i < Math.min(start + 12, times.length); i++) {
      const c = d.hourly.weather_code[i], p = d.hourly.precipitation_probability?.[i] || 0;
      if (c >= 51 || p >= 60) {
        const hr = new Date(times[i]).getHours(), snow = (c >= 71 && c <= 77) || c === 85 || c === 86;
        rain = `预计 ${hr}:00 ${snow ? "有雪" : "有雨"}${p ? `（${p}%）` : ""} 🌧️`;
        break;
      }
    }
    let days = "", labels = ["今天", "明天", "后天"];
    for (let i = 1; i < Math.min(3, d.daily.time.length); i++) {
      days += `<span>${labels[i]} ${wxInfo(d.daily.weather_code[i]).emoji} ${Math.round(d.daily.temperature_2m_max[i])}°/${Math.round(d.daily.temperature_2m_min[i])}°</span>`;
    }
    body.innerHTML = `<div class="wx-cur"><span class="wx-emoji">${cur.emoji}</span><span class="wx-temp">${Math.round(d.current.temperature_2m)}°</span></div><p class="wx-sub">${cur.label} · 最高 ${Math.round(d.daily.temperature_2m_max[0])}° / 最低 ${Math.round(d.daily.temperature_2m_min[0])}°</p><p class="wx-rain">${rain}</p><div class="wx-hours">${hours}</div><div class="wx-days">${days}</div>`;
  } catch {
    body.innerHTML = `<p class="notice">天气加载失败。</p>`;
  }
}

// ---------- AI HOT ----------
function pickStr(o, keys) {
  for (const k of keys) { const v = o[k]; if (typeof v === "string" && v) return v; if (typeof v === "number") return String(v); }
  return "";
}
function firstUrl(o, d) {
  if ((d || 0) > 3) return "";
  for (const v of Object.values(o)) {
    if (typeof v === "string" && /^https?:\/\//i.test(v) && !/\.(png|jpe?g|gif|webp|svg|ico)(\?|$)/i.test(v)) return v;
    if (v && typeof v === "object") { const n = firstUrl(v, (d || 0) + 1); if (n) return n; }
  }
  return "";
}
function absUrl(u) {
  if (!u || u === "#") return "";
  return /^https?:\/\//i.test(u) ? u : "https://aihot.virxact.com" + (u.startsWith("/") ? u : "/" + u);
}
async function loadAiHot() {
  const body = $("aihot-body");
  body.innerHTML = `<p class="muted small">加载中…</p>`;
  try {
    const r = await fetch("https://aihot.virxact.com/api/v1/items?mode=selected&window=24h&limit=12", { headers: { Accept: "application/json" } });
    const j = await r.json();
    const list = Array.isArray(j) ? j : j.items || j.data || j.results || [];
    if (!list.length) { body.innerHTML = `<p class="muted small">暂无。</p>`; return; }
    const grid = el("div", "aihot-grid");
    list.slice(0, 12).forEach((it, i) => {
      const url = absUrl(pickStr(it, ["sourceUrl", "source_url", "originalUrl", "origin"])) || absUrl(pickStr(it, ["url", "link", "readUrl", "href", "permalink"])) || firstUrl(it) || "#";
      const a = el("a", "aihot-item");
      a.href = url; a.target = "_blank"; a.rel = "noreferrer";
      const sum = pickStr(it, ["summary", "description", "excerpt", "digest", "abstract"]);
      a.innerHTML = `<span class="aihot-rank ${i < 3 ? "top" : ""}">${i + 1}</span><div style="min-width:0"><div class="aihot-t">${esc(pickStr(it, ["title", "headline", "name"]) || "无标题")}</div>${sum ? `<p class="aihot-s">${esc(sum)}</p>` : ""}<div class="aihot-m">${esc(pickStr(it, ["sourceName", "source_name", "site", "author", "from"]) || "")}</div></div>`;
      grid.appendChild(a);
    });
    body.innerHTML = "";
    body.appendChild(grid);
  } catch {
    body.innerHTML = `<p class="notice">AI HOT 加载失败。</p>`;
  }
}

// ---------- GitHub trending ----------
async function loadTrending() {
  const body = $("trend-body");
  const since = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  try {
    const r = await fetch(`https://api.github.com/search/repositories?q=created:>${since}&sort=stars&order=desc&per_page=12`, { headers: { Accept: "application/vnd.github+json" } });
    if (!r.ok) throw new Error();
    const j = await r.json();
    const repos = j.items || [];
    if (!repos.length) { body.innerHTML = `<p class="muted small">暂无。</p>`; return; }
    const grid = el("div", "repos");
    repos.forEach((rp) => {
      const a = el("a", "repo");
      a.href = rp.html_url; a.target = "_blank"; a.rel = "noreferrer";
      a.innerHTML = `<div class="name"><span class="owner">${esc(rp.owner?.login)}/</span>${esc(rp.name)}</div>${rp.description ? `<p class="desc">${esc(rp.description)}</p>` : ""}<div class="meta">${rp.language ? `<span>${esc(rp.language)}</span>` : ""}<span>★ ${(rp.stargazers_count ?? 0).toLocaleString()}</span></div>`;
      grid.appendChild(a);
    });
    body.innerHTML = ""; body.appendChild(grid);
  } catch {
    body.innerHTML = `<p class="notice">趋势加载失败（GitHub 频率限制,稍后再试）。</p>`;
  }
}

// ---------- theme ----------
function applyThemeLabel() {
  const dark = document.documentElement.dataset.theme !== "light";
  const t = $("theme-toggle");
  t.textContent = dark ? "🌙" : "☀️";
  t.title = dark ? "切换到浅色" : "切换到深色";
}
function initTheme() {
  applyThemeLabel();
  $("theme-toggle").addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("theme", next); } catch {}
    applyThemeLabel();
  });
}

// ---------- boot ----------
async function boot() {
  initTheme();
  tick();
  setInterval(tick, 1000);
  initSearch();
  const cfg = await getCfg();
  loadWeather(cfg.city);
  loadAiHot();
  loadTrending();
  loadTopSites();
  loadBookmarks();
  loadBili();
  $("aihot-refresh").addEventListener("click", loadAiHot);
  loadTodos(cfg.todoistToken);
  loadGitHub(cfg.ghUser, cfg.ghToken);
  loadVps(cfg.vpsUrl);
  if (cfg.vpsUrl) setInterval(() => loadVps(cfg.vpsUrl), 15000);
  $("todo-refresh").addEventListener("click", () => loadTodos(cfg.todoistToken));
}
boot();
