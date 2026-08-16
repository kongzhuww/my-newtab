"use strict";

// ---------- storage ----------
function storageGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}
function storageSet(data) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(data, () => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve();
    });
  });
}
function storageRemove(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.remove(keys, () => {
      if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
      else resolve();
    });
  });
}
function getCfg() {
  return storageGet(["todoistToken", "ghUser", "ghToken", "vpsUrl", "city", "showWeather", "showSites", "showBili", "showTodo", "showBookmarkPanel"]);
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
function fetchTimeout(url, opts = {}, ms = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

async function biliJson(url) {
  const r = await fetch(url, { credentials: "include", headers: { Accept: "application/json" } });
  return r.json();
}
async function loadBili() {
  const body = $("bili-body");
  if (!body) return;
  body.innerHTML = `<p class="muted small">加载中…</p>`;
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
              a.innerHTML = `<img loading="lazy" decoding="async" referrerpolicy="no-referrer" src="${esc((m.cover || "").replace(/^http:/, "https:"))}" alt=""><span class="t">${esc(m.title)}</span>`;
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
    body.innerHTML = `<p class="notice">未配置 Todoist。到 <a href="options.html">设置</a> 填入 API Token。</p>`;
    return;
  }
  body.innerHTML = `<p class="muted small">加载中…</p>`;
  try {
    const r = await fetch("https://api.todoist.com/api/v1/tasks/filter?query=" + encodeURIComponent("today | overdue"), {
      headers: { Authorization: "Bearer " + token },
    });
    if (!r.ok) throw new Error();
    const tasks = (await r.json()).results || [];
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
            const r = await fetch(`https://api.todoist.com/api/v1/tasks/${t.id}/close`, {
              method: "POST",
              headers: { Authorization: "Bearer " + token },
            });
            if (!r.ok) throw new Error();
            b.remove();
          } catch {
            b.classList.remove("done");
            b.querySelector(".check").classList.remove("done");
          }
        }, 300);
      });
      body.appendChild(b);
    });
  } catch {
    body.innerHTML = `<p class="notice">Todoist 加载失败（Token 是否正确？）。</p>`;
  }
}

// ---------- GitHub star (with categories) ----------
const gh = { repos: [], cats: [], map: {}, active: "全部", UNCAT: "未分类", expanded: false };
function ghSave() { chrome.storage.local.set({ ghCats: gh.cats, ghMap: gh.map }); }
async function loadGitHub(user, token) {
  const body = $("gh-body");
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2026-03-10",
  };
  let url;
  if (token) { headers.Authorization = "Bearer " + token; url = "https://api.github.com/user/starred?per_page=100"; if (user) $("gh-user").textContent = user; }
  else if (user) { url = `https://api.github.com/users/${encodeURIComponent(user)}/starred?per_page=100`; $("gh-user").textContent = user; }
  else { body.innerHTML = `<p class="notice">未配置 GitHub。到 <a href="options.html">设置</a> 填用户名（可选 Token）。</p>`; return; }
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
  const SHOW_LIMIT = 8;
  const collapsed = !gh.expanded && shown.length > SHOW_LIMIT;
  const display = collapsed ? shown.slice(0, SHOW_LIMIT) : shown;
  const grid = el("div", "repos");
  display.forEach((rp) => {
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
  if (shown.length > SHOW_LIMIT) {
    const toggle = el("button", "gh-more");
    toggle.textContent = collapsed ? `展开全部 ${shown.length} 个仓库` : "收起";
    toggle.addEventListener("click", () => { gh.expanded = !gh.expanded; renderGh(); });
    body.appendChild(toggle);
  }
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
  if (!url) { body.innerHTML = `<p class="notice">未配置 VPS。到 <a href="options.html">设置</a> 填探针地址（返回 stats JSON 的 HTTPS 接口）。</p>`; return; }
  if (document.hidden) return;
  try {
    const r = await fetchTimeout(url, { headers: { Accept: "application/json" } }, 8000);
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

// ---------- browser shortcuts + bookmarks ----------
function favi(url) {
  try {
    return chrome.runtime.getURL("_favicon/?pageUrl=" + encodeURIComponent(url) + "&size=64");
  } catch {
    return "";
  }
}
function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

const LEAFTAB_DEFAULT_LINKS = [
  { title: "Bilibili", url: "https://www.bilibili.com/", group: "常用网站" },
  { title: "GitHub", url: "https://github.com/", group: "常用网站" },
  { title: "YouTube", url: "https://www.youtube.com/", group: "常用网站" },
  { title: "Reddit", url: "https://www.reddit.com/", group: "常用网站" },
  { title: "ChatGPT", url: "https://chatgpt.com/", group: "AI" },
  { title: "DeepSeek", url: "https://chat.deepseek.com/", group: "AI" },
  { title: "Claude", url: "https://claude.ai/new", group: "AI" },
  { title: "Google AI Studio", url: "https://aistudio.google.com/", group: "AI" },
  { title: "Gmail", url: "https://mail.google.com/", group: "邮箱" },
  { title: "Outlook", url: "https://outlook.live.com/", group: "邮箱" },
  { title: "Todoist", url: "https://app.todoist.com/app/today", group: "工具" },
  { title: "Speedtest", url: "https://www.speedtest.net/", group: "工具" }
];
const LEAFTAB_DEFAULT_GROUP_SIZES = {
  "常用网站": "large",
  "AI": "large",
  "邮箱": "small",
  "工具": "small"
};
function cloneLeaftabDefaultLinks() {
  return LEAFTAB_DEFAULT_LINKS.map((link) => ({ ...link, id: crypto.randomUUID() }));
}

const launcherState = { links: [], groupSizes: {}, editing: false, mergingGroup: "", activeFolder: "", folderMenuGroup: "" };
const homeModulePrefs = { showWeather: true, showSites: true, showBili: true, showTodo: true, showBookmarkPanel: true };
const bookmarkImportState = { items: [], tree: null, loaded: false };
const LAUNCHER_DRAG_TYPE = "application/x-newtab-launcher";

function updateHomeModulePrefs(cfg = {}) {
  homeModulePrefs.showWeather = cfg.showWeather !== false;
  homeModulePrefs.showSites = cfg.showSites !== false;
  homeModulePrefs.showBili = cfg.showBili !== false;
  homeModulePrefs.showTodo = cfg.showTodo !== false;
  homeModulePrefs.showBookmarkPanel = cfg.showBookmarkPanel !== false;
  document.body.classList.toggle("hide-weather", !homeModulePrefs.showWeather);
  document.body.classList.toggle("hide-sites", !homeModulePrefs.showSites);
  document.body.classList.toggle("hide-bili", !homeModulePrefs.showBili);
  document.body.classList.toggle("hide-todo", !homeModulePrefs.showTodo);
  document.body.classList.toggle("hide-bookmarks", !homeModulePrefs.showBookmarkPanel);
  const weather = document.querySelector(".launcher-weather");
  const todo = document.querySelector(".launcher-todo");
  if (weather) weather.hidden = !homeModulePrefs.showWeather;
  if (todo) todo.hidden = !homeModulePrefs.showTodo;
  const bookmarkPanel = $("bookmark-panel");
  if (bookmarkPanel) bookmarkPanel.hidden = !homeModulePrefs.showBookmarkPanel;
  if (!homeModulePrefs.showBookmarkPanel) closeBookmarkPanel();
  if (!homeModulePrefs.showWeather && $("weather-body")) $("weather-body").innerHTML = `<p class="muted small">加载中…</p>`;
  if (!homeModulePrefs.showTodo && $("todo-body")) $("todo-body").innerHTML = `<p class="muted small">加载中…</p>`;
}


function getTopSites() {
  return new Promise((resolve) => {
    if (!chrome.topSites) { resolve([]); return; }
    chrome.topSites.get((sites) => resolve(sites || []));
  });
}

function normalizeWebUrl(value) {
  let url = value.trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) url = "https://" + url;
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("unsupported protocol");
  return parsed.href;
}

const BACKGROUND_CURRENT_KEY = "hero";
const BACKGROUND_HISTORY_KEY = "heroBackgroundHistory";
const BACKGROUND_HISTORY_LIMIT = 8;
let heroBackgroundUrls = [];

function trackHeroBackgroundUrl(url) {
  heroBackgroundUrls.push(url);
  return url;
}

function clearHeroBackgroundUrl() {
  heroBackgroundUrls.forEach((url) => URL.revokeObjectURL(url));
  heroBackgroundUrls = [];
}

function openBackgroundDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("my-newtab-background", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("files");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function backgroundDbPut(value, key = BACKGROUND_CURRENT_KEY) {
  const db = await openBackgroundDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("files", "readwrite");
    tx.objectStore("files").put(value, key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

async function backgroundDbGet(key = BACKGROUND_CURRENT_KEY) {
  const db = await openBackgroundDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("files", "readonly");
    const request = tx.objectStore("files").get(key);
    request.onsuccess = () => resolve(request.result || null);
    tx.oncomplete = () => db.close();
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

async function backgroundDbClear(key = BACKGROUND_CURRENT_KEY) {
  const db = await openBackgroundDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("files", "readwrite");
    tx.objectStore("files").delete(key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

async function setLauncherBackground(value) {
  const launcher = $("launcher");
  const host = $("hero-background-media");
  if (!launcher || !host) return;
  clearHeroBackgroundUrl();
  host.innerHTML = "";
  launcher.style.removeProperty("--launcher-image");

  if (!value) return;
  if (typeof value === "string") {
    launcher.style.setProperty("--launcher-image", `url(${JSON.stringify(value)})`);
    return;
  }
  if (value.type === "web") {
    const pack = await backgroundDbGet(value.storageKey || BACKGROUND_CURRENT_KEY);
    if (pack?.type === "web") await mountWebWallpaper(pack, host);
    return;
  }
  if (value.type === "db") {
    const file = await backgroundDbGet(value.storageKey || BACKGROUND_CURRENT_KEY);
    if (!file) return;
    const url = trackHeroBackgroundUrl(URL.createObjectURL(file));
    if (/^video\//i.test(file.type || "") || /\.(mp4|webm)$/i.test(file.name || "")) {
      const video = document.createElement("video");
      video.src = url;
      video.autoplay = true;
      video.loop = true;
      video.muted = true;
      video.playsInline = true;
      host.appendChild(video);
    } else {
      const image = document.createElement("img");
      image.src = url;
      image.alt = "";
      host.appendChild(image);
    }
  }
}

function backgroundHistoryTitle(value) {
  if (!value) return "默认背景";
  if (typeof value === "string") return "自定义图片";
  return value.name || (value.type === "web" ? "Web Wallpaper" : "自定义背景");
}

function backgroundHistoryType(value) {
  if (typeof value === "string") return "图片";
  if (value?.type === "web") return "Web Wallpaper";
  if (value?.type === "db") return /video/i.test(value.mediaType || "") ? "视频" : "图片/GIF";
  return "背景";
}

async function addBackgroundHistory(value, payload = null) {
  const id = `bg-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let itemValue = value;
  if (value && typeof value === "object") itemValue = { ...value, storageKey: id };
  if (payload) {
    await backgroundDbClear(BACKGROUND_CURRENT_KEY);
    await backgroundDbPut(payload, id);
  }
  const stored = await storageGet([BACKGROUND_HISTORY_KEY]);
  const history = Array.isArray(stored[BACKGROUND_HISTORY_KEY]) ? stored[BACKGROUND_HISTORY_KEY] : [];
  const item = { id, title: backgroundHistoryTitle(itemValue), kind: backgroundHistoryType(itemValue), createdAt: Date.now(), value: itemValue };
  const next = [item, ...history.filter((old) => JSON.stringify(old.value) !== JSON.stringify(itemValue))].slice(0, BACKGROUND_HISTORY_LIMIT);
  const dropped = history.slice(BACKGROUND_HISTORY_LIMIT - 1).filter((old) => old.value?.storageKey);
  await Promise.all(dropped.map((old) => backgroundDbClear(old.value.storageKey)));
  await storageSet({ [BACKGROUND_HISTORY_KEY]: next });
  return itemValue;
}

function renderBackgroundHistory(history = []) {
  const body = $("background-history-list");
  if (!body) return;
  body.innerHTML = "";
  if (!history.length) {
    const empty = el("p", "muted small");
    empty.textContent = "还没有保存过壁纸。";
    body.appendChild(empty);
    return;
  }
  history.forEach((item) => {
    const row = el("div", "background-history-item");
    const info = el("button", "background-history-main");
    info.type = "button";
    const title = el("b");
    title.textContent = item.title || "自定义背景";
    const meta = el("span");
    meta.textContent = `${item.kind || "背景"} · ${new Date(item.createdAt || Date.now()).toLocaleString()}`;
    info.append(title, meta);
    info.addEventListener("click", async () => {
      await storageSet({ heroBackground: item.value });
      await setLauncherBackground(item.value);
      $("background-history-dialog").close();
    });
    const del = el("button", "background-history-delete");
    del.type = "button";
    del.textContent = "删除";
    del.addEventListener("click", async () => {
      const stored = await storageGet([BACKGROUND_HISTORY_KEY, "heroBackground"]);
      const next = (stored[BACKGROUND_HISTORY_KEY] || []).filter((old) => old.id !== item.id);
      if (item.value?.storageKey) await backgroundDbClear(item.value.storageKey);
      await storageSet({ [BACKGROUND_HISTORY_KEY]: next });
      if (JSON.stringify(stored.heroBackground) === JSON.stringify(item.value)) await clearImportedBackground();
      renderBackgroundHistory(next);
    });
    row.append(info, del);
    body.appendChild(row);
  });
}

async function openBackgroundHistory() {
  const stored = await storageGet([BACKGROUND_HISTORY_KEY]);
  renderBackgroundHistory(Array.isArray(stored[BACKGROUND_HISTORY_KEY]) ? stored[BACKGROUND_HISTORY_KEY] : []);
  $("background-history-dialog")?.showModal();
}

async function saveLauncherLinks() {
  await storageSet({
    quickLinks: launcherState.links,
    quickLinkGroupSizes: launcherState.groupSizes,
    quickLinksReady: true,
  });
}

function launcherGroupNames() {
  return Array.from(new Set(launcherState.links.map((link) => link.group || "常用网站")));
}

function launcherGroupSize(groupName) {
  if (launcherState.groupSizes[groupName] === "small") return "small";
  if (launcherState.groupSizes[groupName] === "large") return "large";
  return groupName === "常用网站" ? "large" : "small";
}

function uniqueLauncherGroupName(title) {
  const names = new Set(launcherGroupNames());
  const base = `${(title || "新").trim().slice(0, 14)}收藏夹`;
  if (!names.has(base)) return base;
  let suffix = 2;
  while (names.has(`${base} ${suffix}`)) suffix += 1;
  return `${base} ${suffix}`;
}

function removeUnusedGroupSizes(groupNames) {
  groupNames.forEach((groupName) => {
    if (!launcherState.links.some((link) => (link.group || "常用网站") === groupName)) {
      delete launcherState.groupSizes[groupName];
    }
  });
}

async function stackLauncherLinks(sourceId, targetId) {
  if (!sourceId || sourceId === targetId) return;
  const source = launcherState.links.find((link) => link.id === sourceId);
  const target = launcherState.links.find((link) => link.id === targetId);
  if (!source || !target) return;
  const sourceGroup = source.group || "常用网站";
  const targetGroup = target.group || "常用网站";
  const targetGroupCount = launcherState.links.filter((link) => (link.group || "常用网站") === targetGroup).length;

  if (sourceGroup !== targetGroup && targetGroup !== "常用网站" && targetGroupCount > 1) {
    source.group = targetGroup;
    launcherState.groupSizes[targetGroup] = "large";
    removeUnusedGroupSizes([sourceGroup]);
  } else if (sourceGroup !== targetGroup || targetGroup === "常用网站") {
    const groupName = uniqueLauncherGroupName(target.title);
    source.group = groupName;
    target.group = groupName;
    launcherState.groupSizes[groupName] = "small";
    removeUnusedGroupSizes([sourceGroup, targetGroup]);
  } else {
    return;
  }
  await saveLauncherLinks();
  renderLaunchers();
}

async function toggleLauncherGroupSize(groupName) {
  launcherState.groupSizes[groupName] = launcherGroupSize(groupName) === "large" ? "small" : "large";
  await saveLauncherLinks();
  renderLaunchers();
}

function openGroupMerge(groupName) {
  const targets = launcherGroupNames().filter((name) => name !== groupName);
  if (!targets.length) return;
  launcherState.mergingGroup = groupName;
  $("group-merge-copy").textContent = `“${groupName}”中的网站将移入目标收藏夹，重复网址只保留一份。`;
  const select = $("group-merge-target");
  select.innerHTML = "";
  targets.forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    select.appendChild(option);
  });
  $("group-merge-dialog").showModal();
}

async function mergeLauncherGroups(source, target) {
  if (!source || !target || source === target) return;
  const urls = new Set();
  launcherState.links
    .filter((link) => (link.group || "常用网站") === target)
    .forEach((link) => {
      try { urls.add(normalizeWebUrl(link.url)); } catch {}
    });
  launcherState.links = launcherState.links.filter((link) => {
    if ((link.group || "常用网站") !== source) return true;
    let url = link.url;
    try { url = normalizeWebUrl(link.url); } catch {}
    if (urls.has(url)) return false;
    urls.add(url);
    link.group = target;
    return true;
  });
  delete launcherState.groupSizes[source];
  await saveLauncherLinks();
  renderLaunchers();
}

async function importLauncherLink(item, groupName) {
  let url;
  try { url = normalizeWebUrl(item.url); } catch { return; }
  const existing = launcherState.links.find((link) => {
    try { return normalizeWebUrl(link.url) === url; } catch { return false; }
  });
  if (existing) {
    existing.group = groupName;
    if (!existing.title && item.title) existing.title = item.title;
  } else {
    launcherState.links.push({
      id: crypto.randomUUID(),
      title: item.title || hostOf(url),
      url,
      group: groupName,
    });
  }
  await saveLauncherLinks();
  renderLaunchers();
}

function dragHasUrl(event) {
  const types = Array.from(event.dataTransfer?.types || []);
  return types.includes(LAUNCHER_DRAG_TYPE) || types.includes("application/x-newtab-bookmark") || types.includes("text/uri-list") || types.includes("text/plain");
}

function clearDropTargets() {
  document.querySelectorAll(".drop-target").forEach((target) => target.classList.remove("drop-target"));
  document.querySelectorAll(".launcher-link.merge-target").forEach((link) => link.classList.remove("merge-target"));
}

function collectBookmarks(node, path, out) {
  const nextPath = node.title ? [...path, node.title] : path;
  for (const child of node.children || []) {
    if (child.url) out.push({ title: child.title || hostOf(child.url), url: child.url, folder: nextPath.join(" / ") || "书签" });
    else collectBookmarks(child, nextPath, out);
  }
  return out;
}

function createBookmarkImportRow(item, depth = 0) {
  const row = el("div", "bookmark-import-item");
  row.style.setProperty("--bookmark-depth", String(Math.min(depth, 6)));
  row.draggable = true;
  row.title = "拖到快捷入口分组";
  const icon = document.createElement("img");
  icon.src = favi(item.url);
  icon.alt = "";
  const copy = el("span", "bookmark-import-copy");
  const title = el("span", "bookmark-import-title");
  title.textContent = item.title;
  const meta = el("span", "bookmark-import-host");
  meta.textContent = item.folder ? `${hostOf(item.url)} · ${item.folder}` : hostOf(item.url);
  copy.appendChild(title);
  copy.appendChild(meta);
  const add = el("button", "bookmark-import-add");
  add.type = "button";
  add.title = "导入到常用网站";
  add.textContent = "＋";
  add.addEventListener("click", () => importLauncherLink(item, "常用网站"));
  row.addEventListener("dragstart", (event) => {
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("application/x-newtab-bookmark", JSON.stringify(item));
    event.dataTransfer.setData("text/uri-list", item.url);
  });
  row.addEventListener("dragend", clearDropTargets);
  row.appendChild(icon);
  row.appendChild(copy);
  row.appendChild(add);
  return row;
}

function countBookmarkLinks(node) {
  if (!node) return 0;
  return (node.children || []).reduce((sum, child) => sum + (child.url ? 1 : countBookmarkLinks(child)), 0);
}

function renderBookmarkTreeNode(node, path, depth) {
  if (node.url) {
    return createBookmarkImportRow({ title: node.title || hostOf(node.url), url: node.url, folder: path.join(" / ") || "书签" }, depth);
  }
  const children = node.children || [];
  const details = el("details", "bookmark-tree-folder");
  if (depth < 1) details.open = true;
  const summary = document.createElement("summary");
  const name = node.title || "书签";
  summary.innerHTML = `<span class="bookmark-folder-name">📁 ${esc(name)}</span><span class="bookmark-folder-count">${countBookmarkLinks(node)}</span>`;
  details.appendChild(summary);
  const group = el("div", "bookmark-tree-children");
  children.forEach((child) => group.appendChild(renderBookmarkTreeNode(child, node.title ? [...path, node.title] : path, depth + 1)));
  details.appendChild(group);
  return details;
}

function renderBookmarkImports(query = "") {
  const body = $("bookmark-import-list");
  const keyword = query.trim().toLowerCase();
  body.innerHTML = "";
  if (!bookmarkImportState.items.length) {
    const empty = el("p", "bookmark-import-empty");
    empty.textContent = "书签栏为空";
    body.appendChild(empty);
    return;
  }

  if (keyword) {
    const items = bookmarkImportState.items.filter((item) => `${item.title} ${item.url} ${item.folder}`.toLowerCase().includes(keyword));
    if (!items.length) {
      const empty = el("p", "bookmark-import-empty");
      empty.textContent = "没有匹配的书签";
      body.appendChild(empty);
      return;
    }
    items.forEach((item) => body.appendChild(createBookmarkImportRow(item, 0)));
    return;
  }

  const tree = el("div", "bookmark-tree");
  (bookmarkImportState.tree?.children || []).forEach((child) => tree.appendChild(renderBookmarkTreeNode(child, [], 0)));
  body.appendChild(tree);
}

async function openBookmarkPanel() {
  const panel = $("bookmark-panel");
  panel.classList.add("open");
  $("bookmark-handle").setAttribute("aria-expanded", "true");
  $("bookmark-handle").title = "收起浏览器书签";
  $("bookmark-handle-icon").textContent = "‹";
  if (!bookmarkImportState.loaded) {
    const tree = await new Promise((resolve) => chrome.bookmarks.getTree(resolve));
    bookmarkImportState.tree = tree[0] || {};
    bookmarkImportState.items = collectBookmarks(bookmarkImportState.tree, [], []).sort((a, b) =>
      a.folder.localeCompare(b.folder, "zh") || a.title.localeCompare(b.title, "zh"));
    bookmarkImportState.loaded = true;
  }
  renderBookmarkImports($("bookmark-search").value);
  $("bookmark-search").focus();
}

function closeBookmarkPanel() {
  $("bookmark-panel").classList.remove("open");
  $("bookmark-handle").setAttribute("aria-expanded", "false");
  $("bookmark-handle").title = "展开浏览器书签";
  $("bookmark-handle-icon").textContent = "📁";
  clearDropTargets();
}

function toggleBookmarkPanel() {
  if ($("bookmark-panel").classList.contains("open")) closeBookmarkPanel();
  else openBookmarkPanel();
}

function openLauncherEditor(link) {
  $("launcher-dialog-title").textContent = link ? "编辑网站" : "添加网站";
  $("launcher-id").value = link?.id || "";
  $("launcher-title").value = link?.title || "";
  $("launcher-url").value = link?.url || "";
  $("launcher-group").value = link?.group || "常用网站";
  $("launcher-delete").style.display = link ? "inline-block" : "none";
  $("launcher-dialog").showModal();
  $("launcher-title").focus();
}

function createLauncherIcon(link, className = "launcher-favicon") {
  const icon = el("span", className);
  const fallback = el("span", "launcher-fallback");
  fallback.textContent = (link.title || hostOf(link.url)).trim().slice(0, 1).toUpperCase();
  const img = document.createElement("img");
  img.alt = "";
  img.referrerPolicy = "no-referrer";

  const host = hostOf(link.url);
  let origin = "";
  try { origin = new URL(link.url).origin; } catch {}

  // 图标源优先级：favicon.im(国内可达、真实图标) → 浏览器本地缓存 → 站点自带 favicon.ico
  const sources = ["https://favicon.im/" + encodeURIComponent(host), favi(link.url)];
  if (origin) sources.push(origin + "/favicon.ico");

  let idx = 0;
  img.addEventListener("load", () => {
    fallback.style.display = "none";
  });
  img.addEventListener("error", () => {
    idx += 1;
    if (idx < sources.length) {
      img.src = sources[idx];
    } else {
      img.style.display = "none";
    }
  });

  img.src = sources[0];
  icon.appendChild(fallback);
  icon.appendChild(img);
  return icon;
}

function createLauncherLink(link, closeFolderOnEdit = false) {
  const anchor = el("a", "launcher-link");
  anchor.href = link.url;
  anchor.target = "_blank";
  anchor.rel = "noreferrer";
  anchor.title = link.title + "\n" + link.url;
  anchor.draggable = true;
  const label = el("span", "launcher-label");
  label.textContent = link.title;
  anchor.appendChild(createLauncherIcon(link));
  anchor.appendChild(label);
  anchor.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    if (closeFolderOnEdit) $("launcher-folder-dialog").close();
    openLauncherEditor(link);
  });
  anchor.addEventListener("dragstart", (event) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(LAUNCHER_DRAG_TYPE, link.id);
    event.dataTransfer.setData("text/uri-list", link.url);
    anchor.classList.add("dragging");
  });
  anchor.addEventListener("dragover", (event) => {
    if (!Array.from(event.dataTransfer?.types || []).includes(LAUNCHER_DRAG_TYPE)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    clearDropTargets();
    anchor.classList.add("merge-target");
  });
  anchor.addEventListener("dragleave", () => anchor.classList.remove("merge-target"));
  anchor.addEventListener("drop", async (event) => {
    const sourceId = event.dataTransfer.getData(LAUNCHER_DRAG_TYPE);
    if (!sourceId) return;
    event.preventDefault();
    event.stopPropagation();
    clearDropTargets();
    await stackLauncherLinks(sourceId, link.id);
  });
  anchor.addEventListener("dragend", () => {
    anchor.classList.remove("dragging");
    clearDropTargets();
  });
  return anchor;
}

async function importDroppedLauncherItem(event, groupName) {
  const sourceId = event.dataTransfer.getData(LAUNCHER_DRAG_TYPE);
  if (sourceId) {
    const source = launcherState.links.find((link) => link.id === sourceId);
    if (source) await importLauncherLink(source, groupName);
    return;
  }
  let item;
  const packed = event.dataTransfer.getData("application/x-newtab-bookmark");
  if (packed) {
    try { item = JSON.parse(packed); } catch {}
  }
  if (!item) {
    const uri = event.dataTransfer.getData("text/uri-list").split(/\r?\n/).find((line) => line && !line.startsWith("#"));
    const text = uri || event.dataTransfer.getData("text/plain");
    if (text) item = { title: hostOf(text.trim()), url: text.trim() };
  }
  if (item) await importLauncherLink(item, groupName);
}

function makeLauncherDropTarget(target, groupName) {
  target.addEventListener("dragover", (event) => {
    if (!dragHasUrl(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = Array.from(event.dataTransfer?.types || []).includes(LAUNCHER_DRAG_TYPE) ? "move" : "copy";
    clearDropTargets();
    target.classList.add("drop-target");
  });
  target.addEventListener("dragleave", (event) => {
    if (!target.contains(event.relatedTarget)) target.classList.remove("drop-target");
  });
  target.addEventListener("drop", async (event) => {
    event.preventDefault();
    event.stopPropagation();
    clearDropTargets();
    await importDroppedLauncherItem(event, groupName);
  });
}

function renderLauncherFolderDialog(groupName = launcherState.activeFolder) {
  launcherState.activeFolder = groupName;
  $("launcher-folder-dialog-title").textContent = groupName;
  const body = $("launcher-folder-dialog-items");
  body.innerHTML = "";
  launcherState.links
    .filter((link) => (link.group || "常用网站") === groupName)
    .forEach((link) => body.appendChild(createLauncherLink(link, true)));
}

function openLauncherFolder(groupName) {
  renderLauncherFolderDialog(groupName);
  $("launcher-folder-backdrop").hidden = false;
  // 非模态打开：允许把文件夹里的网站拖出去，也能从外面拖进来
  const dialog = $("launcher-folder-dialog");
  if (!dialog.open) dialog.show();
  positionFolderDialog();
}

function positionFolderDialog() {
  const sites = document.querySelector(".launcher-sites");
  const dialog = $("launcher-folder-dialog");
  if (!sites || !dialog) return;
  const rect = sites.getBoundingClientRect();
  dialog.style.top = Math.max(8, rect.top) + "px";
  dialog.style.left = Math.max(8, rect.left) + "px";
  dialog.style.right = "auto";
}

function closeFolderMenu() {
  $("folder-menu").hidden = true;
  $("folder-menu-backdrop").hidden = true;
  launcherState.folderMenuGroup = "";
}

function openFolderMenu(groupName, event) {
  event.preventDefault();
  closeFolderMenu();
  launcherState.folderMenuGroup = groupName;
  const menu = $("folder-menu");
  $("folder-menu-title").textContent = groupName;
  $("folder-menu-size").textContent = launcherGroupSize(groupName) === "small" ? "扩大为大收藏夹" : "缩小为小收藏夹";
  $("folder-menu-merge").disabled = launcherGroupNames().filter((name) => name !== "常用网站").length < 2;
  $("folder-menu-backdrop").hidden = false;
  menu.hidden = false;
  menu.style.left = Math.max(8, Math.min(innerWidth - menu.offsetWidth - 8, event.clientX)) + "px";
  menu.style.top = Math.max(8, Math.min(innerHeight - menu.offsetHeight - 8, event.clientY)) + "px";
}

function createLauncherFolder(groupName, links) {
  const size = launcherGroupSize(groupName);
  const folder = el("div", `launcher-folder size-${size}`);
  folder.title = `${groupName}\n右键调整收藏夹大小`;
  const preview = el("button", "launcher-folder-preview");
  preview.type = "button";
  preview.title = `打开${groupName}`;
  const capacity = size === "large" ? 9 : 4;
  const visibleCount = links.length > capacity ? capacity - 1 : capacity;
  links.slice(0, visibleCount).forEach((link) => {
    preview.appendChild(createLauncherIcon(link, "launcher-folder-mini"));
  });
  if (links.length > capacity) {
    const more = el("span", "launcher-folder-more");
    more.textContent = `+${links.length - visibleCount}`;
    preview.appendChild(more);
  }
  const label = el("span", "launcher-folder-label");
  label.textContent = groupName;
  preview.addEventListener("click", () => openLauncherFolder(groupName));
  folder.addEventListener("contextmenu", (event) => openFolderMenu(groupName, event));
  folder.appendChild(preview);
  folder.appendChild(label);
  makeLauncherDropTarget(folder, groupName);
  return folder;
}

function createBiliLauncherCard() {
  const card = el("section", "launcher-group launcher-bili size-large");
  card.id = "launcher-bili";
  card.innerHTML = `<header class="card-head">
    <span class="bar pink"></span>
    <h2>B站收藏夹</h2>
    <span class="grow"></span>
    <span id="bili-user" class="muted small"></span>
  </header>
  <div id="bili-body"><p class="muted small">加载中…</p></div>`;
  return card;
}

function renderLaunchers() {
  const body = $("launcher-groups");
  body.innerHTML = "";
  body.classList.toggle("has-sites", homeModulePrefs.showSites);
  body.classList.toggle("has-bili", homeModulePrefs.showBili);

  const common = el("section", "launcher-group launcher-sites size-large");
  const head = el("header", "launcher-group-head");
  const heading = el("h2");
  heading.textContent = "常用网站";
  head.appendChild(heading);
  const items = el("div", "launcher-items launcher-site-items");
  const folders = new Map();
  launcherState.links.forEach((link) => {
    const groupName = link.group || "常用网站";
    if (groupName === "常用网站") return;
    if (!folders.has(groupName)) folders.set(groupName, []);
    folders.get(groupName).push(link);
  });

  const renderedFolders = new Set();
  launcherState.links.forEach((link) => {
    const groupName = link.group || "常用网站";
    if (groupName === "常用网站") {
      items.appendChild(createLauncherLink(link));
    } else if (!renderedFolders.has(groupName)) {
      renderedFolders.add(groupName);
      items.appendChild(createLauncherFolder(groupName, folders.get(groupName)));
    }
  });
  if (!launcherState.links.length) {
    const empty = el("p", "launcher-empty");
    empty.textContent = "还没有快捷入口，点击“编辑入口”后添加。";
    items.appendChild(empty);
  }
  common.appendChild(head);
  common.appendChild(items);
  makeLauncherDropTarget(common, "常用网站");
  if (homeModulePrefs.showSites) body.appendChild(common);
  if (homeModulePrefs.showBili) body.appendChild(createBiliLauncherCard());

  if ($("launcher-folder-dialog").open && launcherState.activeFolder) {
    renderLauncherFolderDialog();
  }
}

function isBackgroundMedia(file) {
  return file && (/^image\//i.test(file.type || "") || /^video\//i.test(file.type || "") || /\.(png|jpe?g|webp|gif|mp4|webm)$/i.test(file.name || ""));
}


const WALLPAPER_MAX_FILES = 450;
const WALLPAPER_MAX_BYTES = 180 * 1024 * 1024;

function normalizeWallpaperPath(path) {
  return String(path || "").replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

function resolveWallpaperPath(fromPath, target) {
  const raw = String(target || "").trim().replace(/^['"]|['"]$/g, "");
  if (!raw || /^(?:[a-z][a-z0-9+.-]*:|#|data:|blob:)/i.test(raw)) return "";
  const [pathname] = raw.split(/[?#]/);
  if (!pathname) return "";
  const base = raw.startsWith("/") ? "" : normalizeWallpaperPath(fromPath).split("/").slice(0, -1).join("/");
  const parts = `${base ? base + "/" : ""}${pathname.replace(/^\/+/, "")}`.split("/");
  const stack = [];
  parts.forEach((part) => {
    if (!part || part === ".") return;
    if (part === "..") stack.pop();
    else stack.push(part);
  });
  return stack.join("/").toLowerCase();
}

async function collectWallpaperFiles(handle) {
  const files = [];
  let total = 0;
  async function walk(dir, prefix = "", depth = 0) {
    if (depth > 4 || files.length >= WALLPAPER_MAX_FILES || total >= WALLPAPER_MAX_BYTES) return;
    for await (const entry of dir.values()) {
      const path = normalizeWallpaperPath(prefix ? `${prefix}/${entry.name}` : entry.name);
      if (entry.kind === "file") {
        const file = await entry.getFile();
        total += file.size || 0;
        if (total <= WALLPAPER_MAX_BYTES) files.push({ path, file });
      } else if (entry.kind === "directory") {
        await walk(entry, path, depth + 1);
      }
    }
  }
  await walk(handle);
  return files;
}

function findWebWallpaperEntry(entries) {
  return entries
    .filter((entry) => /(^|\/)index\.html?$/i.test(entry.path) || /\.html?$/i.test(entry.path))
    .sort((a, b) => {
      const score = (entry) => /^index\.html?$/i.test(entry.path) ? 0 : /(^|\/)index\.html?$/i.test(entry.path) ? 1 : 2;
      return score(a) - score(b) || a.path.length - b.path.length;
    })[0] || null;
}

function collectProjectMediaRefs(value, refs = []) {
  if (typeof value === "string") {
    if (/\.(png|jpe?g|webp|gif|mp4|webm|html?)($|[?#])/i.test(value)) refs.push(value);
  } else if (Array.isArray(value)) {
    value.forEach((item) => collectProjectMediaRefs(item, refs));
  } else if (value && typeof value === "object") {
    Object.values(value).forEach((item) => collectProjectMediaRefs(item, refs));
  }
  return refs;
}

async function pickProjectReferencedMedia(entries) {
  const map = new Map(entries.map((entry) => [normalizeWallpaperPath(entry.path).toLowerCase(), entry]));
  const projects = entries.filter((entry) => /(^|\/)project\.json$/i.test(entry.path));
  for (const project of projects) {
    try {
      const json = JSON.parse(await project.file.text());
      for (const ref of collectProjectMediaRefs(json)) {
        const entry = map.get(resolveWallpaperPath(project.path, ref));
        if (entry && isBackgroundMedia(entry.file)) return entry.file;
      }
    } catch { /* ignore malformed third-party metadata */ }
  }
  return null;
}

function getWallpaperMime(path, file) {
  if (file.type) return file.type;
  if (/\.html?$/i.test(path)) return "text/html";
  if (/\.css$/i.test(path)) return "text/css";
  if (/\.m?js$/i.test(path)) return "text/javascript";
  if (/\.png$/i.test(path)) return "image/png";
  if (/\.jpe?g$/i.test(path)) return "image/jpeg";
  if (/\.webp$/i.test(path)) return "image/webp";
  if (/\.gif$/i.test(path)) return "image/gif";
  if (/\.mp4$/i.test(path)) return "video/mp4";
  if (/\.webm$/i.test(path)) return "video/webm";
  return "application/octet-stream";
}

function buildWebWallpaperPack(dirName, entry, entries) {
  const usable = entries
    .filter((item) => !/\.(pkg|mpkg)$/i.test(item.path))
    .map((item) => ({ path: item.path, file: item.file, mime: getWallpaperMime(item.path, item.file) }));
  return { type: "web", name: dirName || "Web Wallpaper", entry: entry.path, files: usable };
}

async function pickWallpaperMediaFromDirectory(handle) {
  const entries = await collectWallpaperFiles(handle);
  const webEntry = findWebWallpaperEntry(entries);
  if (webEntry) return buildWebWallpaperPack(handle.name, webEntry, entries);

  const projectMedia = await pickProjectReferencedMedia(entries);
  if (projectMedia) return projectMedia;

  const files = entries.map((entry) => entry.file).filter(isBackgroundMedia);
  return files.sort((a, b) => {
    const score = (f) => /\.(mp4|webm)$/i.test(f.name) ? 0 : /\.gif$/i.test(f.name) ? 1 : /^preview\./i.test(f.name) ? 2 : /cover|thumb|poster/i.test(f.name) ? 3 : 4;
    return score(a) - score(b) || b.size - a.size;
  })[0] || null;
}

async function mountWebWallpaper(pack, host) {
  const iframe = document.createElement("iframe");
  iframe.title = pack.name || "Web Wallpaper";
  iframe.src = chrome.runtime.getURL("wallpaper-sandbox.html");
  iframe.onload = () => iframe.contentWindow?.postMessage(pack, "*");
  host.appendChild(iframe);
}

async function chooseBackgroundFile() {
  if (window.showDirectoryPicker && confirm("要导入 Wallpaper Engine 文件夹吗？\n确定：选择 Wallpaper 文件夹，支持 Web Wallpaper（index.html），并会优先使用 MP4/WebM/GIF/项目主图。\n取消：选择普通图片/GIF/视频文件。")) {
    const dir = await window.showDirectoryPicker();
    const file = await pickWallpaperMediaFromDirectory(dir);
    if (!file) throw new Error("未在 Wallpaper 文件夹里找到可用的 Web Wallpaper、图片、GIF、MP4 或 WebM。");
    return file;
  }
  return new Promise((resolve) => {
    const input = $("background-input");
    input.onchange = () => {
      resolve(input.files?.[0] || null);
      input.value = "";
    };
    input.click();
  });
}

async function initLaunchers() {
  const stored = await storageGet(["quickLinks", "quickLinkGroupSizes", "quickLinkFolderTilesReady", "quickLinksReady", "heroBackground", "leaftabBackup20260728Migrated", "showWeather", "showSites", "showBili", "showTodo", "showBookmarkPanel"]);
  updateHomeModulePrefs(stored);
  launcherState.groupSizes = stored.quickLinkGroupSizes && typeof stored.quickLinkGroupSizes === "object"
    ? stored.quickLinkGroupSizes
    : {};
  if (!stored.leaftabBackup20260728Migrated) {
    launcherState.links = cloneLeaftabDefaultLinks();
    launcherState.groupSizes = { ...launcherState.groupSizes, ...LEAFTAB_DEFAULT_GROUP_SIZES };
    await saveLauncherLinks();
    await storageSet({ leaftabBackup20260728Migrated: true });
  } else if (stored.quickLinksReady) {
    launcherState.links = Array.isArray(stored.quickLinks) ? stored.quickLinks : [];
  } else {
    const sites = await getTopSites();
    launcherState.links = sites.slice(0, 14).map((site) => ({
      id: crypto.randomUUID(),
      title: site.title || hostOf(site.url),
      url: site.url,
      group: "常用网站",
    }));
    await saveLauncherLinks();
  }
  if (!stored.quickLinkFolderTilesReady) {
    const folderCounts = new Map();
    launcherState.links.forEach((link) => {
      const groupName = link.group || "常用网站";
      if (groupName !== "常用网站") folderCounts.set(groupName, (folderCounts.get(groupName) || 0) + 1);
    });
    folderCounts.forEach((count, groupName) => {
      launcherState.groupSizes[groupName] = count <= 4 ? "small" : "large";
    });
    await saveLauncherLinks();
    await storageSet({ quickLinkFolderTilesReady: true });
  }
  await setLauncherBackground(stored.heroBackground);
  renderLaunchers();

  $("bookmark-handle").title = "展开浏览器书签，拖到快捷入口分组可添加网站";
  $("bookmark-handle").addEventListener("click", toggleBookmarkPanel);
  $("bookmark-close").addEventListener("click", closeBookmarkPanel);
  $("bookmark-search").addEventListener("input", (event) => renderBookmarkImports(event.target.value));
  $("folder-menu-backdrop").addEventListener("click", closeFolderMenu);
  $("folder-menu-backdrop").addEventListener("contextmenu", (event) => {
    event.preventDefault();
    closeFolderMenu();
  });
  $("folder-menu-size").addEventListener("click", async () => {
    const groupName = launcherState.folderMenuGroup;
    closeFolderMenu();
    if (groupName) await toggleLauncherGroupSize(groupName);
  });
  $("folder-menu-merge").addEventListener("click", () => {
    const groupName = launcherState.folderMenuGroup;
    closeFolderMenu();
    if (groupName) openGroupMerge(groupName);
  });
  $("launcher-folder-close").addEventListener("click", () => $("launcher-folder-dialog").close());
  $("launcher-folder-dialog").addEventListener("close", () => {
    launcherState.activeFolder = "";
    $("launcher-folder-backdrop").hidden = true;
  });
  $("launcher-folder-dialog").addEventListener("cancel", (event) => {
    event.preventDefault();
    $("launcher-folder-dialog").close();
  });
  // 点击弹窗外部关闭（用 mousedown：它先于打开动作，避免打开文件夹的那次 click 冒泡误关）
  document.addEventListener("mousedown", (event) => {
    const dialog = $("launcher-folder-dialog");
    if (dialog && dialog.open && !dialog.contains(event.target)) {
      dialog.close();
    }
  });
  $("launcher-cancel").addEventListener("click", () => $("launcher-dialog").close());
  $("group-merge-cancel").addEventListener("click", () => $("group-merge-dialog").close());
  $("group-merge-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    await mergeLauncherGroups(launcherState.mergingGroup, $("group-merge-target").value);
    launcherState.mergingGroup = "";
    $("group-merge-dialog").close();
  });
  $("launcher-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const id = $("launcher-id").value;
    const title = $("launcher-title").value.trim();
    let url;
    try {
      url = normalizeWebUrl($("launcher-url").value);
      $("launcher-url").setCustomValidity("");
    } catch {
      $("launcher-url").setCustomValidity("请输入有效的 http 或 https 网址");
      $("launcher-url").reportValidity();
      return;
    }
    const link = {
      id: id || crypto.randomUUID(),
      title,
      url,
      group: $("launcher-group").value.trim() || "常用网站",
    };
    const index = launcherState.links.findIndex((item) => item.id === id);
    if (index >= 0) launcherState.links[index] = link;
    else launcherState.links.push(link);
    await saveLauncherLinks();
    renderLaunchers();
    $("launcher-dialog").close();
  });
  $("launcher-delete").addEventListener("click", async () => {
    const id = $("launcher-id").value;
    launcherState.links = launcherState.links.filter((link) => link.id !== id);
    await saveLauncherLinks();
    renderLaunchers();
    $("launcher-dialog").close();
  });

  $("background-change").addEventListener("click", async () => {
    try {
      const file = await chooseBackgroundFile();
      if (!file) return;
      let value;
      let payload = null;
      if (file.type === "web") {
        payload = file;
        value = { type: "web", name: file.name, entry: file.entry };
      } else if (!isBackgroundMedia(file)) {
        alert("请选择图片、GIF、MP4、WebM 或包含 index.html 的 Web Wallpaper 文件夹。");
        return;
      } else {
        payload = file;
        value = { type: "db", name: file.name, mediaType: file.type || "application/octet-stream" };
      }
      value = await addBackgroundHistory(value, payload);
      await storageSet({ heroBackground: value });
      await setLauncherBackground(value);
    } catch (error) {
      if (error?.name !== "AbortError") alert(error?.message || "背景保存失败，请换一张尺寸较小的图片。");
    }
  });
  $("background-history").addEventListener("click", openBackgroundHistory);
  $("background-history-close").addEventListener("click", () => $("background-history-dialog").close());
  $("background-reset").addEventListener("click", clearImportedBackground);
  $("default-reset").addEventListener("click", clearImportedBackground);
}


async function clearImportedBackground() {
  await storageRemove("heroBackground");
  await backgroundDbClear();
  await setLauncherBackground("");
}

// ---------- search ----------
function initSearch() {
  const form = $("search"), input = $("search-input");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    const isUrl =
      /^https?:\/\//i.test(q) ||
      /^localhost(?::\d+)?(?:\/\S*)?$/i.test(q) ||
      /^(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?(?:\/\S*)?$/.test(q) ||
      (!q.includes(" ") && /^[\w-]+(\.[\w-]+)+(?:\/\S*)?$/.test(q));
    location.href = isUrl ? normalizeWebUrl(q) : "https://www.bing.com/search?q=" + encodeURIComponent(q);
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
    body.innerHTML = `<p class="notice">未设置城市。到 <a href="options.html">设置</a> 填写城市名（如 武汉 / Tokyo）。</p>`;
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


// ---------- page switch ----------
function initPageSwitch() {
  const button = $("daily-toggle");
  const daily = $("daily-section");
  if (!button || !daily) return;
  const setPage = (page) => {
    const dailyMode = page === "daily";
    document.body.dataset.page = dailyMode ? "daily" : "home";
    button.textContent = dailyMode ? "🏠 首页" : "📰 日报";
    button.title = dailyMode ? "返回首页" : "查看日报";
    if (dailyMode) daily.scrollTop = 0;
  };
  button.addEventListener("click", () => setPage(document.body.dataset.page === "daily" ? "home" : "daily"));
  setPage("home");
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

// ---------- home modules ----------
function applyHomeModules(cfg) {
  updateHomeModulePrefs(cfg);
  renderLaunchers();
  if (homeModulePrefs.showWeather) loadWeather(cfg.city);
  if (homeModulePrefs.showBili) loadBili();
  if (homeModulePrefs.showTodo) loadTodos(cfg.todoistToken);
}

function watchHomeModuleSettings(cfg) {
  if (!chrome.storage?.onChanged) return;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    const watched = ["showWeather", "showSites", "showBili", "showTodo", "showBookmarkPanel", "city", "todoistToken"];
    if (!watched.some((key) => key in changes)) return;
    watched.forEach((key) => {
      if (key in changes) cfg[key] = changes[key].newValue;
    });
    applyHomeModules(cfg);
  });
}

// ---------- traffic card (中兴 F50 Pro 流量卡) ----------
const TRAFFIC_API = "http://192.168.0.1/goform/goform_get_cmd_process?cmd=flux_monthly_tx_bytes,flux_monthly_rx_bytes,flux_data_volume_limit_size,flux_data_volume_limit_unit";

function setTrafficQuota() {
  const v = prompt("输入套餐总额度（GB）：", "");
  if (v === null) return;
  const n = parseFloat(v);
  if (!isFinite(n) || n <= 0) return;
  chrome.storage.local.set({ trafficQuota: n }, () => loadTraffic());
}

async function loadTraffic() {
  const body = $("traffic-body");
  if (!body) return;
  try {
    const r = await fetchTimeout(TRAFFIC_API, { cache: "no-store" }, 6000);
    const j = await r.json();
    const tx = Number(j.flux_monthly_tx_bytes || j.monthly_tx_bytes || 0);
    const rx = Number(j.flux_monthly_rx_bytes || j.monthly_rx_bytes || 0);
    const used = (tx + rx) / 1073741824; // GB
    const stored = await storageGet(["trafficQuota"]);
    const quota = Number(stored.trafficQuota) || 180; // 默认 180GB 套餐
    if (quota > 0) {
      const left = Math.max(0, quota - used);
      const pct = Math.min(100, (used / quota) * 100);
      body.innerHTML =
        `<div class="traffic-bar"><div class="traffic-fill" style="width:${pct.toFixed(1)}%"></div></div>` +
        `<p class="traffic-line">已用 <b>${used.toFixed(1)} GB</b> / ${quota} GB · 剩余 <b>${left.toFixed(1)} GB</b></p>` +
        `<p class="muted small" id="traffic-set">点击调整套餐额度</p>`;
    } else {
      body.innerHTML =
        `<div class="traffic-bar"><div class="traffic-fill" style="width:100%"></div></div>` +
        `<p class="traffic-line">本月已用 <b>${used.toFixed(1)} GB</b></p>` +
        `<p class="muted small" id="traffic-set">点击设置套餐额度（用于算剩余）</p>`;
    }
    const btn = $("traffic-set");
    if (btn) btn.addEventListener("click", setTrafficQuota);
  } catch {
    body.innerHTML = '<p class="muted small">未连接流量卡（需连 192.168.0.1 网络）</p>';
  }
}

// ---------- subtitle workbench (B站收藏夹 + srt 转纯文本) ----------
async function getFlatGroups() {
  const stored = await storageGet(["foTree", "foGroups"]);
  let result = {};
  if (stored.foTree && stored.foTree.children) {
    const walk = (node, path) => {
      (node.children || []).forEach((c) => {
        if (c.type === "folder") walk(c, path ? path + " / " + c.name : c.name);
        else {
          const p = path || "未分组";
          (result[p] = result[p] || []).push(Number(c.id));
        }
      });
    };
    walk(stored.foTree, "");
  } else {
    result = stored.foGroups || {};
  }
  // 统一 id 为数字，避免树节点里字符串 id 与 B站 folders 数字 id 不匹配
  const norm = {};
  Object.entries(result).forEach(([g, fids]) => {
    norm[g] = (fids || []).map((fid) => Number(fid)).filter((n) => !Number.isNaN(n));
  });
  return norm;
}

async function loadBiliWorkbench() {
  const body = $("wb-bili");
  if (!body) return;
  body.innerHTML = `<p class="muted small">加载中…</p>`;
  try {
    const nav = await biliJson("https://api.bilibili.com/x/web-interface/nav");
    if (!nav?.data?.isLogin) { body.innerHTML = `<p class="notice">未登录 B 站，请先在 <a href="https://www.bilibili.com" target="_blank" rel="noreferrer">bilibili.com</a> 登录。</p>`; return; }
    const mid = nav.data.mid;
    const fj = await biliJson(`https://api.bilibili.com/x/v3/fav/folder/created/list-all?up_mid=${mid}`);
    const folders = fj?.data?.list || [];
    if (!folders.length) { body.innerHTML = `<p class="muted small">没有找到收藏夹。</p>`; return; }
    const groups = await getFlatGroups();
    const grouped = new Set(Object.values(groups).flat());
    body.innerHTML = "";

    const makeFolder = (f) => {
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
              a.target = "_blank"; a.rel = "noreferrer";
              a.innerHTML = `<img loading="lazy" decoding="async" referrerpolicy="no-referrer" src="${esc((m.cover || "").replace(/^http:/, "https:"))}" alt=""><span class="t">${esc(m.title)}</span>`;
              items.appendChild(a);
            });
          } catch { items.innerHTML = `<p class="muted small">加载失败</p>`; }
        }
      });
      wrap.appendChild(head); wrap.appendChild(items);
      return wrap;
    };

    Object.entries(groups).forEach(([gname, fids]) => {
      if (!(fids || []).length) return;
      const grp = el("div", "folder-group");
      grp.innerHTML = `<div class="folder-group-head">📁 ${esc(gname)}</div>`;
      (fids || []).forEach((fid) => {
        const f = folders.find((x) => x.id === fid);
        if (f) grp.appendChild(makeFolder(f));
      });
      body.appendChild(grp);
    });

    const ungrouped = folders.filter((f) => !grouped.has(f.id));
    ungrouped.forEach((f) => body.appendChild(makeFolder(f)));
  } catch { body.innerHTML = `<p class="muted small">加载失败</p>`; }
}

function md5(inputStr) {
  function L(x, c) { return (x << c) | (x >>> (32 - c)); }
  const S = [7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21];
  const K = new Array(64).fill(0).map((_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32));
  const bytes = new TextEncoder().encode(inputStr);
  const bitLen = bytes.length * 8;
  const padded = new Uint8Array((Math.floor((bytes.length + 8) / 64) + 1) * 64);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 8, bitLen >>> 0, true);
  dv.setUint32(padded.length - 4, Math.floor(bitLen / 0x100000000), true);
  let a = 0x67452301, b = 0xefcdab89, c = 0x98badcfe, d = 0x10325476;
  for (let i = 0; i < padded.length; i += 64) {
    const M = new Array(16);
    for (let j = 0; j < 16; j++) M[j] = dv.getUint32(i + j * 4, true);
    let A = a, B = b, C = c, D = d;
    for (let j = 0; j < 64; j++) {
      let F, g;
      if (j < 16) { F = (B & C) | (~B & D); g = j; }
      else if (j < 32) { F = (D & B) | (~D & C); g = (5 * j + 1) % 16; }
      else if (j < 48) { F = B ^ C ^ D; g = (3 * j + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * j) % 16; }
      const tmp = (F + A + K[j] + M[g]) >>> 0;
      A = D; D = C; C = B;
      B = (B + L(tmp, S[j])) >>> 0;
    }
    a = (a + A) >>> 0; b = (b + B) >>> 0; c = (c + C) >>> 0; d = (d + D) >>> 0;
  }
  function le(x) { let s = ""; for (let i = 0; i < 4; i++) s += ((x >>> (i * 8)) & 0xff).toString(16).padStart(2, "0"); return s; }
  return le(a) + le(b) + le(c) + le(d);
}

// B站 wbi 签名
const WBI_MIXIN_TAB = [46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52];
let wbiKeysCache = null;
async function getWbiKeys() {
  if (wbiKeysCache) return wbiKeysCache;
  const nav = await biliJson("https://api.bilibili.com/x/web-interface/nav");
  const ik = nav.data.wbi_img.img_url.split("/").pop().split(".")[0];
  const sk = nav.data.wbi_img.sub_url.split("/").pop().split(".")[0];
  wbiKeysCache = { ik, sk };
  return wbiKeysCache;
}
function encWbi(params, ik, sk) {
  const mk = WBI_MIXIN_TAB.map((i) => (ik + sk)[i]).join("").slice(0, 32);
  const wts = Math.round(Date.now() / 1000);
  const p = { ...params, wts };
  const q = Object.keys(p).sort().map((k) => encodeURIComponent(k) + "=" + encodeURIComponent(String(p[k]).replace(/[!'()*]/g, ""))).join("&");
  return q + "&w_rid=" + md5(q + mk);
}
function extractBvid(text) {
  const m = String(text || "").match(/BV[0-9A-Za-z]{10}/);
  return m ? m[0] : "";
}
function fmtBiliDate(ts) {
  const d = new Date(ts * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
async function fetchBiliSubtitle(bvid) {
  const view = await biliJson(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`);
  if (!view?.data?.cid) return { ok: false, reason: "视频不存在，或 B站未登录" };
  const d = view.data;
  const cid = d.cid;
  const { ik, sk } = await getWbiKeys();
  const q = encWbi({ bvid, cid }, ik, sk);
  const pj = await biliJson(`https://api.bilibili.com/x/player/wbi/v2?${q}`);
  const subs = pj?.data?.subtitle?.subtitles || [];
  if (!subs.length) return { ok: false, reason: "该视频没有 AI 字幕" };
  // 优先选中文（AI 中文 / 简体 / 繁体），否则取第一条；避免取到外语字幕被误当"乱码"
  const pick = subs.find((s) => /zh|中文|汉语|漢語/i.test((s.lan || "") + " " + (s.lan_doc || ""))) || subs[0];
  const rawUrl = pick.subtitle_url || "";
  const subUrl = /^https?:\/\//i.test(rawUrl) ? rawUrl : "https:" + rawUrl;
  // 显式按 UTF-8 解码字幕 JSON，防止 BOM / 编码不一致导致乱码
  const subR = await fetch(subUrl, { credentials: "include", headers: { Accept: "application/json" } });
  const subBuf = await subR.arrayBuffer();
  let subJ;
  try {
    subJ = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(subBuf));
  } catch {
    try {
      subJ = JSON.parse(new TextDecoder("gb18030").decode(subBuf));
    } catch {
      subJ = JSON.parse(new TextDecoder("big5").decode(subBuf));
    }
  }
  const body = subJ?.body || [];
  const lines = body.map((b) => (b.content || "").trim()).filter(Boolean);
  if (!lines.length) return { ok: false, reason: "字幕内容为空" };

  const meta = [];
  meta.push("标题：" + (d.title || bvid));
  meta.push("字幕轨道：" + subs.map((s) => s.lan_doc || s.lan || "未知").join(" / ") + "（已选：" + (pick.lan_doc || pick.lan || "默认") + "）");
  if (d.owner?.name) meta.push("UP主：" + d.owner.name);
  if (d.pubdate) meta.push("发布时间：" + fmtBiliDate(d.pubdate));
  if (d.stat) meta.push("播放：" + (d.stat.view ?? 0).toLocaleString() + " · 点赞：" + (d.stat.like ?? 0).toLocaleString());
  if (d.tname) meta.push("分区：" + d.tname);
  meta.push("链接：https://www.bilibili.com/video/" + bvid);

  const bodyText = lines.join("\n");
  const headText = meta.join("\n") + "\n\n———— 字幕正文 ————\n\n";
  return { ok: true, title: d.title || bvid, bodyText, headText, lineCount: lines.length };
}

function srtToPlainText(srt) {
  const lines = srt.replace(/^\uFEFF/, "").split(/\r?\n/);
  const out = [];
  let buf = [];
  const flush = () => {
    const text = buf
      .filter((l) => !/^\d+$/.test(l) && !l.includes("-->") && !/^(WEBVTT|Kind:|Language:)/i.test(l))
      .join("\n").trim();
    if (text) out.push(text);
    buf = [];
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (line === "") flush();
    else buf.push(line);
  }
  flush();
  return out.join("\n");
}

function extractSubtitles(text, filename) {
  const ext = (filename || "").split(".").pop().toLowerCase();
  // 1) JSON（B站字幕：{"body":[{"from":..,"content":"..."}]}）
  if (ext === "json" || /^\s*[\[{]/.test(text)) {
    try {
      const j = JSON.parse(text);
      const body = j?.body || j?.data?.body || (Array.isArray(j) ? j : null);
      if (Array.isArray(body) && body.length) {
        const lines = body.map((b) => (b && typeof b === "object" ? b.content : String(b))).filter((s) => s && String(s).trim());
        if (lines.length) return lines.join("\n");
      }
    } catch {}
  }
  // 2) ASS（[Events] 段的 Dialogue: 行）
  if (text.includes("[Events]")) {
    const dialogues = text.split(/\r?\n/).filter((l) => /^Dialogue:/i.test(l));
    if (dialogues.length) {
      const lines = dialogues.map((l) => {
        const content = l.split(",").slice(9).join(",").replace(/\{[^}]*\}/g, "").replace(/\\N/g, "\n").trim();
        return content;
      }).filter(Boolean);
      if (lines.length) return lines.join("\n");
    }
  }
  // 3) srt / vtt
  return srtToPlainText(text);
}

function initSrtTool() {
  const drop = $("srt-drop");
  const output = $("srt-output");
  const status = $("srt-status");
  if (!drop || !output) return;
  let lastBody = "", lastHead = "";
  const setStatus = (msg, cls) => {
    if (!status) return;
    status.textContent = msg || "";
    status.className = "srt-status" + (cls ? " " + cls : "");
  };
  const readFile = async (f) => {
    output.value = "";
    setStatus("处理中…", "busy");
    try {
      // 自动识别编码：BOM 判断 UTF-16；否则优先 UTF-8，非法字节（GBK/ANSI）回退 GB18030
      const buf = await f.arrayBuffer();
      const head = new Uint8Array(buf, 0, Math.min(2, buf.byteLength));
      let text;
      if (head[0] === 0xff && head[1] === 0xfe) {
        text = new TextDecoder("utf-16le").decode(buf);
      } else if (head[0] === 0xfe && head[1] === 0xff) {
        text = new TextDecoder("utf-16be").decode(buf);
      } else {
        try {
          text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
        } catch {
          text = new TextDecoder("gb18030").decode(buf);
        }
      }
      const result = extractSubtitles(text, f.name);
      if (result.trim()) {
        output.value = result;
        const lineCount = result.split("\n").filter(Boolean).length;
        setStatus(`✅ 已提取 ${lineCount} 行文本（${f.name}）`, "ok");
      } else {
        setStatus(`⚠️ 未识别到字幕内容：${f.name} 可能不是字幕文件，或格式不支持`, "err");
      }
    } catch (e) {
      setStatus(`❌ 读取文件失败：${e.message}`, "err");
    }
  };
  drop.addEventListener("click", () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".srt,.vtt,.txt,.json,.ass";
    input.addEventListener("change", () => { if (input.files?.[0]) readFile(input.files[0]); });
    input.click();
  });
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("dragover"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("dragover"));
  drop.addEventListener("drop", async (e) => {
    e.preventDefault(); drop.classList.remove("dragover");
    const file = e.dataTransfer.files?.[0];
    if (file) { readFile(file); return; }
    const uri = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain") || "";
    const bvid = extractBvid(uri);
    if (bvid) {
      output.value = "";
      setStatus("正在抓取 B站字幕…", "busy");
      try {
        const r = await fetchBiliSubtitle(bvid);
        if (r.ok) {
          lastBody = r.bodyText; lastHead = r.headText;
          output.value = r.headText + r.bodyText;
          setStatus(`✅ 已提取 ${r.lineCount} 行字幕（${r.title}）`, "ok");
        }
        else setStatus("⚠️ " + r.reason, "err");
      } catch (err) { setStatus("❌ 抓取失败：" + err.message, "err"); }
    } else {
      setStatus("⚠️ 没识别到 B站视频链接，请从左边拖视频卡片过来", "err");
    }
  });
  const doCopy = async (text, btn) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      const old = btn.textContent;
      btn.textContent = "✅ 已复制";
      setTimeout(() => (btn.textContent = old), 1500);
    } catch { setStatus("❌ 复制失败", "err"); }
  };
  $("srt-copy").addEventListener("click", () => doCopy(lastBody || output.value, $("srt-copy")));
  $("srt-copy-all").addEventListener("click", () => doCopy((lastHead || "") + (lastBody || output.value), $("srt-copy-all")));
  $("srt-clear").addEventListener("click", () => { output.value = ""; lastBody = ""; lastHead = ""; setStatus("", ""); });
}

// ---------- folder organizer (按视频标签自动分类到收藏夹) ----------
const BILI_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

async function getBiliJct() {
  try {
    const c = await chrome.cookies.get({ url: "https://bilibili.com", name: "bili_jct" });
    return c?.value || "";
  } catch { return ""; }
}

async function moveBiliVideo(srcId, tarId, aid, mid) {
  const csrf = await getBiliJct();
  if (!csrf) return { ok: false, reason: "取不到 csrf（bili_jct）" };
  try {
    const body = new URLSearchParams({
      src_media_id: String(srcId),
      tar_media_id: String(tarId),
      mid: String(mid),
      resources: aid + ":2",
      platform: "web",
      csrf,
    });
    const r = await fetch("https://api.bilibili.com/x/v3/fav/resource/move", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "User-Agent": BILI_UA,
        Referer: "https://www.bilibili.com/",
        Origin: "https://www.bilibili.com",
      },
      body: body.toString(),
    });
    const j = await r.json();
    if (j.code === 0) return { ok: true };
    return { ok: false, reason: j.message || ("code " + j.code) };
  } catch (e) { return { ok: false, reason: e.message }; }
}

async function deleteBiliVideo(fid, aid) {
  const csrf = await getBiliJct();
  if (!csrf) return { ok: false, reason: "取不到 csrf（bili_jct）" };
  try {
    const body = new URLSearchParams({
      csrf,
      rid: String(aid),
      type: "2",
      del_media_ids: String(fid),
    });
    const r = await fetch("https://api.bilibili.com/x/v3/fav/resource/deal", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
        "User-Agent": BILI_UA,
        Referer: "https://www.bilibili.com/",
        Origin: "https://www.bilibili.com",
      },
      body: body.toString(),
    });
    const j = await r.json();
    if (j.code === 0) return { ok: true };
    return { ok: false, reason: j.message || ("code " + j.code) };
  } catch (e) { return { ok: false, reason: e.message }; }
}

// 朴素贝叶斯分类器：从手动移动的历史里学习「视频特征 → 收藏夹」
const foModel = { classes: {} };

function bayesFeatures(media, tags) {
  const feats = [];
  (tags || []).forEach((t) => { if (t) feats.push("t:" + t); });
  if (media.tname) feats.push("z:" + media.tname);
  if (media.upper?.name) feats.push("u:" + media.upper.name);
  return feats;
}

function bayesTrain(folderId, features) {
  if (!folderId || !features.length) return;
  if (!foModel.classes[folderId]) foModel.classes[folderId] = { words: {}, total: 0, docs: 0 };
  const c = foModel.classes[folderId];
  features.forEach((w) => { c.words[w] = (c.words[w] || 0) + 1; c.total++; });
  c.docs++;
  chrome.storage.local.set({ foBayes: foModel.classes });
}

function bayesPredict(features) {
  const ids = Object.keys(foModel.classes);
  if (!ids.length || !features.length) return null;
  const vocab = new Set();
  Object.values(foModel.classes).forEach((c) => Object.keys(c.words).forEach((w) => vocab.add(w)));
  const vocabSize = vocab.size || 1;
  const totalDocs = Object.values(foModel.classes).reduce((s, c) => s + c.docs, 0);
  const scores = {};
  for (const fid of ids) {
    const c = foModel.classes[fid];
    let score = Math.log(c.docs / totalDocs);
    features.forEach((w) => {
      score += Math.log(((c.words[w] || 0) + 1) / (c.total + vocabSize));
    });
    scores[fid] = score;
  }
  // softmax 转置信度（百分比）
  const maxScore = Math.max(...Object.values(scores));
  let sum = 0;
  const exps = {};
  ids.forEach((fid) => { exps[fid] = Math.exp(scores[fid] - maxScore); sum += exps[fid]; });
  let best = null, bestConf = -1;
  ids.forEach((fid) => { const p = exps[fid] / sum; if (p > bestConf) { bestConf = p; best = fid; } });
  return { id: best, confidence: Math.round(bestConf * 100) };
}

function bayesStats() {
  let docs = 0, words = 0;
  Object.values(foModel.classes).forEach((c) => { docs += c.docs; words += c.total; });
  return { docs, words, classes: Object.keys(foModel.classes).length };
}

function showBayesDetail() {
  const entries = Object.entries(foModel.classes);
  if (!entries.length) { alert("贝叶斯还没学过任何分类。手动移动几个视频后就有数据了。"); return; }
  const lines = entries.map(([fid, c]) => {
    const top = Object.entries(c.words).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([w, n]) => `${w.replace(/^[tzu]:/, "")}×${n}`).join("、");
    return `「收藏夹#${fid}」已学 ${c.docs} 次，特征词：${top || "无"}`;
  }).join("\n");
  alert("贝叶斯学习情况：\n\n" + lines + "\n\n提示：收藏夹 id 对应的名字见下拉框（可把 id 换成名字，下次我改好显示）");
}

function manageFoAliases() {
  const cur = foState.aliases;
  const hint = "每行一个文件夹别名，格式：\n文件夹名：别名1、别名2\n\n例如：\n教程：学习、教学、课程\n搞笑：鬼畜、沙雕";
  const v = prompt(hint, Object.entries(cur).map(([k, arr]) => `${k}：${arr.join("、")}`).join("\n"));
  if (v === null) return;
  const next = {};
  v.split(/\r?\n/).forEach((line) => {
    const [k, ...rest] = line.split(/[：:]/);
    if (!k || !k.trim()) return;
    const aliases = (rest.join(":") || "").split(/[、,，]/).map((s) => s.trim()).filter(Boolean);
    next[k.trim()] = aliases;
  });
  foState.aliases = next;
  chrome.storage.local.set({ foAliases: next }, () => loadFolderOrganizer());
}

// ---------- B站收藏夹资源管理器 ----------
function initFmTabs() {
  document.querySelectorAll(".fm-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".fm-tab").forEach((t) => t.classList.remove("on"));
      tab.classList.add("on");
      document.querySelectorAll(".fm-pane").forEach((p) => (p.hidden = true));
      const pane = $("pane-" + tab.dataset.tab);
      if (pane) pane.hidden = false;
    });
  });
}

const fmState = { folders: [], groups: {}, currentFid: null };

async function loadFileManager() {
  const sidebar = $("fm-sidebar");
  if (!sidebar) return;
  sidebar.innerHTML = '<p class="muted small">加载中…</p>';
  try {
    const nav = await biliJson("https://api.bilibili.com/x/web-interface/nav");
    if (!nav?.data?.isLogin) { sidebar.innerHTML = '<p class="notice">未登录 B 站，请先登录 <a href="https://www.bilibili.com" target="_blank" rel="noreferrer">bilibili.com</a>。</p>'; return; }
    foState.mid = nav.data.mid;
    const fj = await biliJson(`https://api.bilibili.com/x/v3/fav/folder/created/list-all?up_mid=${foState.mid}`);
    fmState.folders = fj?.data?.list || [];
    const stored = await storageGet(["foGroups", "foBayes"]);
    fmState.groups = stored.foGroups || {};
    foModel.classes = stored.foBayes || {};
    renderFmSidebar();
    if (!fmState.currentFid || !fmState.folders.some((f) => f.id === fmState.currentFid)) {
      const def = fmState.folders.find((f) => /默认/.test(f.title)) || fmState.folders[0];
      if (def) openFmFolder(def.id);
    }
  } catch (e) {
    sidebar.innerHTML = '<p class="muted small">加载失败：' + esc(e.message) + '</p>';
  }
}

function renderFmSidebar() {
  const sidebar = $("fm-sidebar");
  sidebar.innerHTML = "";
  const grouped = new Set(Object.values(fmState.groups).flat());
  const makeFolderItem = (f) => {
    const item = el("div", "fm-folder-item" + (fmState.currentFid === f.id ? " on" : ""));
    item.innerHTML = `<span class="fm-folder-name">${esc(f.title)}</span><span class="fm-count">${f.media_count || ""}</span>`;
    item.addEventListener("click", () => openFmFolder(f.id));
    return item;
  };

  Object.entries(fmState.groups).forEach(([gname, fids]) => {
    if (!(fids || []).length) return;
    const grp = el("div", "fm-group");
    const head = el("div", "fm-group-head");
    head.innerHTML = `<span class="caret">▸</span><span>📁 ${esc(gname)}</span>`;
    const body = el("div", "fm-group-body");
    body.style.display = "none";
    head.addEventListener("click", () => {
      const open = body.style.display !== "none";
      body.style.display = open ? "none" : "block";
      head.querySelector(".caret").textContent = open ? "▸" : "▾";
    });
    (fids || []).forEach((fid) => {
      const f = fmState.folders.find((x) => x.id === fid);
      if (f) body.appendChild(makeFolderItem(f));
    });
    grp.appendChild(head);
    grp.appendChild(body);
    sidebar.appendChild(grp);
  });

  const ungrouped = fmState.folders.filter((f) => !grouped.has(f.id));
  ungrouped.forEach((f) => sidebar.appendChild(makeFolderItem(f)));
}

async function openFmFolder(fid) {
  fmState.currentFid = fid;
  const folder = fmState.folders.find((f) => f.id === fid);
  const status = $("fm-status");
  if (status) status.textContent = folder?.title || "";
  renderFmSidebar();
  const vids = $("fm-videos");
  if (!vids) return;
  vids.innerHTML = '<p class="muted small">加载中…</p>';
  try {
    const rj = await biliJson(`https://api.bilibili.com/x/v3/fav/resource/list?media_id=${fid}&pn=1&ps=30&platform=web`);
    const medias = rj?.data?.medias || [];
    renderFmVideos(folder, medias);
  } catch (e) {
    vids.innerHTML = '<p class="muted small">加载失败：' + esc(e.message) + '</p>';
  }
}

function renderFmVideos(folder, medias) {
  const vids = $("fm-videos");
  vids.innerHTML = "";
  const targetFolders = fmState.folders.filter((f) => f.id !== folder.id);
  if (!medias.length) { vids.appendChild(el("p", "muted small", "这个收藏夹是空的。")); return; }

  const toolbar = el("div", "fo-toolbar");
  const modeBtn = el("button", "fo-btn");
  modeBtn.textContent = foState.auto ? "🔄 手动批准" : "⚡ 自动(full access)";
  modeBtn.addEventListener("click", async () => {
    foState.auto = !foState.auto;
    await chrome.storage.local.set({ foAuto: foState.auto });
    openFmFolder(folder.id);
  });
  toolbar.appendChild(modeBtn);
  toolbar.appendChild(el("span", "muted small", `共 ${medias.length} 个视频`));
  vids.appendChild(toolbar);

  medias.forEach((m) => {
    const row = el("div", "fo-item");
    const aid = m.id || m.aid;
    const bvid = m.bvid || "";
    const cover = (m.cover || "").replace(/^http:/, "https:");
    const videoUrl = bvid ? `https://www.bilibili.com/video/${bvid}` : "#";
    row.innerHTML =
      `<a class="fo-cover-link" href="${videoUrl}" target="_blank" rel="noreferrer"><img class="fo-cover" loading="lazy" referrerpolicy="no-referrer" src="${esc(cover)}" alt=""></a>` +
      `<div class="fo-item-main"><div class="fo-item-title"><a class="fo-title-link" href="${videoUrl}" target="_blank" rel="noreferrer">${esc(m.title)}</a></div></div>`;

    const subBtn = el("button", "fo-btn", "字幕");
    subBtn.title = "提取这个视频的字幕";
    subBtn.addEventListener("click", async () => {
      subBtn.disabled = true; subBtn.textContent = "提取中…";
      try {
        const r = await fetchBiliSubtitle(bvid);
        const out = $("srt-output");
        const st = $("srt-status");
        if (r.ok) {
          if (out) out.value = r.headText + r.bodyText;
          if (st) { st.textContent = `✅ 已提取（${r.title}）`; st.className = "srt-status ok"; }
        } else {
          if (st) { st.textContent = "⚠️ " + r.reason; st.className = "srt-status err"; }
        }
      } catch (e) {
        const st = $("srt-status");
        if (st) { st.textContent = "❌ " + e.message; st.className = "srt-status err"; }
      }
      subBtn.disabled = false; subBtn.textContent = "字幕";
    });
    row.appendChild(subBtn);

    const sel = el("select", "fo-sel");
    sel.innerHTML = `<option value="">移动…</option>` + targetFolders.map((f) => `<option value="${f.id}">${esc(f.title)}</option>`).join("");
    const moveBtn = el("button", "fo-move");
    moveBtn.textContent = "移动";
    moveBtn.addEventListener("click", async () => {
      const fid = sel.value;
      if (!fid) return;
      moveBtn.disabled = true; moveBtn.textContent = "…";
      const res = await moveBiliVideo(folder.id, fid, aid, foState.mid);
      if (res.ok) { row.remove(); }
      else { moveBtn.disabled = false; moveBtn.textContent = "重试"; alert("移动失败：" + res.reason); }
    });
    row.appendChild(sel);
    row.appendChild(moveBtn);

    const delBtn = el("button", "fo-del");
    delBtn.textContent = "✕";
    delBtn.title = "取消收藏";
    delBtn.addEventListener("click", async () => {
      if (!confirm(`取消收藏「${m.title}」？`)) return;
      delBtn.disabled = true;
      const res = await deleteBiliVideo(folder.id, aid);
      if (res.ok) row.remove();
      else { delBtn.disabled = false; alert("删除失败：" + res.reason); }
    });
    row.appendChild(delBtn);

    vids.appendChild(row);
  });
}

// ---------- 收藏夹树（文件夹可嵌套，收藏夹为叶子） ----------
let favTree = { id: "root", children: [] };
let favFolders = [];

function newFolderNode(name) {
  return { id: "f" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), type: "folder", name, children: [] };
}
function findNode(node, id) {
  if (node.id === id) return node;
  for (const c of node.children || []) { const r = findNode(c, id); if (r) return r; }
  return null;
}
function findParent(node, id) {
  for (const c of node.children || []) { if (c.id === id) return node; const r = findParent(c, id); if (r) return r; }
  return null;
}
function removeNodeById(node, id) {
  if (!node.children) return false;
  const i = node.children.findIndex((c) => c.id === id);
  if (i >= 0) { node.children.splice(i, 1); return true; }
  for (const c of node.children) if (removeNodeById(c, id)) return true;
  return false;
}
function isDescendant(node, ancestorId) {
  if (node.id === ancestorId) return true;
  for (const c of node.children || []) if (isDescendant(c, ancestorId)) return true;
  return false;
}
function saveTree() { chrome.storage.local.set({ foTree: favTree }, () => loadSubfolderManager()); }

async function openFavFolder(fid, title) {
  const content = $("sf-content");
  if (!content) return;
  document.querySelectorAll(".sf-node.sel").forEach((x) => x.classList.remove("sel"));
  document.querySelectorAll(".sf-node[data-id]").forEach((x) => { if (x.dataset.id === String(fid)) x.classList.add("sel"); });
  content.innerHTML = '<p class="muted small">加载中…</p>';
  try {
    const rj = await biliJson(`https://api.bilibili.com/x/v3/fav/resource/list?media_id=${fid}&pn=1&ps=30&platform=web`);
    const medias = rj?.data?.medias || [];
    content.innerHTML = "";
    content.appendChild(el("p", "sf-content-title", `「${esc(title)}」· ${medias.length} 个视频`));
    if (!medias.length) { content.appendChild(el("p", "muted small", "空收藏夹")); return; }
    const grid = el("div", "sf-video-grid");
    medias.forEach((m) => {
      const card = el("a", "sf-video");
      card.href = m.bvid ? `https://www.bilibili.com/video/${m.bvid}` : "#";
      card.target = "_blank";
      card.rel = "noreferrer";
      const cover = (m.cover || "").replace(/^http:/, "https:");
      const play = m.cnt_info?.play ? (m.cnt_info.play >= 10000 ? (m.cnt_info.play / 10000).toFixed(1) + "万" : m.cnt_info.play) : "";
      card.innerHTML =
        `<img class="sf-video-cover" loading="lazy" referrerpolicy="no-referrer" src="${esc(cover)}" alt="">` +
        `<div class="sf-video-title">${esc(m.title)}</div>` +
        `<div class="sf-video-meta">${m.upper?.name ? esc(m.upper.name) : ""}${play ? " · " + play + "播放" : ""}</div>`;
      grid.appendChild(card);
    });
    content.appendChild(grid);
  } catch (e) {
    content.innerHTML = '<p class="muted small">加载失败：' + esc(e.message) + '</p>';
  }
}

async function loadSubfolderManager() {
  const body = $("subfolder-body");
  if (!body) return;
  body.innerHTML = '<p class="muted small">加载中…</p>';
  try {
    const nav = await biliJson("https://api.bilibili.com/x/web-interface/nav");
    if (!nav?.data?.isLogin) { body.innerHTML = '<p class="notice">未登录 B 站。</p>'; return; }
    const mid = nav.data.mid;
    const fj = await biliJson(`https://api.bilibili.com/x/v3/fav/folder/created/list-all?up_mid=${mid}`);
    favFolders = fj?.data?.list || [];
    const stored = await storageGet(["foTree", "foGroups"]);
    if (stored.foTree && stored.foTree.children) {
      favTree = stored.foTree;
    } else {
      // 迁移旧 foGroups
      favTree = { id: "root", children: [] };
      const groups = stored.foGroups || {};
      Object.entries(groups).forEach(([gname, fids]) => {
        const fn = newFolderNode(gname);
        fn.children = (fids || []).map((fid) => {
          const f = favFolders.find((x) => String(x.id) === String(fid));
          return { id: String(fid), type: "fav", name: f ? f.title : String(fid), children: [] };
        });
        favTree.children.push(fn);
      });
      chrome.storage.local.set({ foTree: favTree });
    }
    renderTree();
  } catch (e) {
    body.innerHTML = '<p class="muted small">加载失败：' + esc(e.message) + '</p>';
  }
}

function renderTree() {
  const body = $("subfolder-body");
  body.innerHTML = "";

  const toolbar = el("div", "fo-toolbar");
  const input = el("input", "sf-input");
  input.placeholder = "新文件夹名";
  const addBtn = el("button", "fo-btn", "＋ 根目录建文件夹");
  addBtn.addEventListener("click", () => {
    const name = input.value.trim();
    if (!name) return;
    favTree.children.push(newFolderNode(name));
    saveTree();
  });
  toolbar.appendChild(input);
  toolbar.appendChild(addBtn);
  body.appendChild(toolbar);
  body.appendChild(el("p", "muted small", "拖动节点调整顺序 / 移入文件夹。点文件夹名可折叠。"));

  const renderChildren = (children, container, depth) => {
    children.forEach((node) => {
      if (node.type === "folder") {
        const folder = el("div", "sf-folder-node");
        const head = el("div", "sf-node");
        head.dataset.id = node.id;
        head.dataset.type = "folder";
        head.style.paddingLeft = (depth * 16 + 8) + "px";
        head.innerHTML = `<span class="caret">▾</span><span class="sf-node-icon">📁</span><span class="sf-node-name">${esc(node.name)}</span>`;
        const addSub = el("button", "sf-node-btn", "＋");
        addSub.title = "建子文件夹";
        addSub.addEventListener("click", (e) => {
          e.stopPropagation();
          const name = prompt("子文件夹名");
          if (!name) return;
          (node.children = node.children || []).push(newFolderNode(name.trim()));
          saveTree();
        });
        const del = el("button", "sf-node-btn", "删");
        del.title = "删除文件夹";
        del.addEventListener("click", (e) => {
          e.stopPropagation();
          if (!confirm(`删除文件夹「${node.name}」？里面的收藏夹会回到根目录。`)) return;
          removeNodeById(favTree, node.id);
          saveTree();
        });
        head.appendChild(addSub);
        head.appendChild(del);
        const kids = el("div", "sf-kids");
        renderChildren(node.children || [], kids, depth + 1);
        const isOpen = node.open !== false;
        kids.style.display = isOpen ? "block" : "none";
        head.querySelector(".caret").textContent = isOpen ? "▾" : "▸";
        head.addEventListener("click", (e) => {
          if (e.target.closest("button")) return;
          node.open = !(node.open !== false);
          kids.style.display = node.open !== false ? "block" : "none";
          head.querySelector(".caret").textContent = node.open !== false ? "▾" : "▸";
          chrome.storage.local.set({ foTree: favTree });
        });
        folder.appendChild(head);
        folder.appendChild(kids);
        container.appendChild(folder);
      } else {
        const item = el("div", "sf-node sf-fav-node");
        item.dataset.id = node.id;
        item.dataset.type = "fav";
        item.style.paddingLeft = (depth * 16 + 8) + "px";
        const ff = favFolders.find((x) => String(x.id) === String(node.id));
        const cover = ff?.cover ? String(ff.cover).replace(/^http:/, "https:") : "";
        item.innerHTML = cover
          ? `<img class="sf-node-cover" loading="lazy" referrerpolicy="no-referrer" src="${esc(cover)}" alt=""><span class="sf-node-name">${esc(node.name)}</span>`
          : `<span class="sf-node-icon">🎬</span><span class="sf-node-name">${esc(node.name)}</span>`;
        item.addEventListener("click", (e) => {
          if (e.target.closest("button")) return;
          openFavFolder(node.id, node.name);
        });
        container.appendChild(item);
      }
    });
  };

  // 未分组收藏夹补到根目录
  const groupedIds = new Set();
  (function collect(n) { (n.children || []).forEach((c) => { if (c.type === "fav") groupedIds.add(c.id); else collect(c); }); })(favTree);
  favFolders.forEach((f) => {
    if (!groupedIds.has(String(f.id))) favTree.children.push({ id: String(f.id), type: "fav", name: f.title, children: [] });
  });

  renderChildren(favTree.children, body, 0);
}

let treeDrag = null;
let treeGhost = null;
function initTreeDrag() {
  document.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    const node = e.target.closest(".sf-node");
    if (!node || e.target.closest("button")) return;
    if (treeGhost) { treeGhost.remove(); treeGhost = null; }
    treeDrag = { id: node.dataset.id, type: node.dataset.type, el: node };
    treeGhost = node.cloneNode(true);
    treeGhost.classList.add("sf-ghost");
    treeGhost.style.width = node.offsetWidth + "px";
    treeGhost.style.left = (e.clientX - 8) + "px";
    treeGhost.style.top = (e.clientY - 8) + "px";
    document.body.appendChild(treeGhost);
    node.classList.add("dragging");
    e.preventDefault();
  });

  document.addEventListener("mousemove", (e) => {
    if (!treeDrag || !treeGhost) return;
    treeGhost.style.left = (e.clientX - 8) + "px";
    treeGhost.style.top = (e.clientY - 8) + "px";
    document.querySelectorAll(".sf-node.insert-before, .sf-node.insert-after, .sf-node.insert-into").forEach((x) => x.classList.remove("insert-before", "insert-after", "insert-into"));
    const t = document.elementFromPoint(e.clientX, e.clientY)?.closest(".sf-node");
    if (t && t !== treeDrag.el) {
      const rect = t.getBoundingClientRect();
      const ratio = (e.clientY - rect.top) / rect.height;
      if (t.dataset.type === "folder" && ratio > 0.3 && ratio < 0.7) t.classList.add("insert-into");
      else t.classList.add(ratio < 0.5 ? "insert-before" : "insert-after");
    }
  });

  document.addEventListener("mouseup", (e) => {
    if (!treeDrag) return;
    if (treeGhost) { treeGhost.remove(); treeGhost = null; }
    document.querySelectorAll(".sf-node.insert-before, .sf-node.insert-after, .sf-node.insert-into").forEach((x) => x.classList.remove("insert-before", "insert-after", "insert-into"));
    treeDrag.el.classList.remove("dragging");
    const t = document.elementFromPoint(e.clientX, e.clientY)?.closest(".sf-node");
    if (t && t !== treeDrag.el) {
      const srcId = treeDrag.id, srcType = treeDrag.type;
      const tgtId = t.dataset.id, tgtType = t.dataset.type;
      const rect = t.getBoundingClientRect();
      const ratio = (e.clientY - rect.top) / rect.height;
      if (srcType === "folder" && findNode(favTree, srcId) && isDescendant(findNode(favTree, srcId), tgtId)) { treeDrag = null; return; }
      const srcNode = findNode(favTree, srcId);
      if (!srcNode) { treeDrag = null; return; }
      const srcCopy = JSON.parse(JSON.stringify(srcNode));
      removeNodeById(favTree, srcId);
      if (tgtType === "folder" && ratio > 0.3 && ratio < 0.7) {
        const tf = findNode(favTree, tgtId);
        if (tf) (tf.children = tf.children || []).push(srcCopy);
      } else {
        const tp = findParent(favTree, tgtId) || favTree;
        const arr = tp.children || (tp.children = []);
        let i = arr.findIndex((c) => c.id === tgtId);
        if (i < 0) i = arr.length;
        if (ratio >= 0.5) i++;
        arr.splice(i, 0, srcCopy);
      }
      saveTree();
    }
    treeDrag = null;
  });
}
async function loadFolderOrganizer() {
  const body = $("fo-body");
  if (!body) return;
  body.innerHTML = '<p class="muted small">加载中…</p>';
  try {
    const nav = await biliJson("https://api.bilibili.com/x/web-interface/nav");
    if (!nav?.data?.isLogin) { body.innerHTML = '<p class="notice">未登录 B 站，请先登录 <a href="https://www.bilibili.com" target="_blank" rel="noreferrer">bilibili.com</a>。</p>'; return; }
    const mid = nav.data.mid;
    foState.mid = mid;
    const fj = await biliJson(`https://api.bilibili.com/x/v3/fav/folder/created/list-all?up_mid=${mid}`);
    const folders = fj?.data?.list || [];
    if (!folders.length) { body.innerHTML = '<p class="muted small">没有收藏夹。</p>'; return; }
    const srcFolder = folders.find((f) => f.id === foState.srcId) || folders.find((f) => /默认/.test(f.title)) || folders[0];
    foState.srcId = srcFolder.id;
    const stored = await storageGet(["foAliases", "foAuto", "foBayes"]);
    foState.aliases = stored.foAliases || {};
    foState.auto = !!stored.foAuto;
    foModel.classes = stored.foBayes || {};
    foState.groups = await getFlatGroups();
    const PS = 10;
    const rj = await biliJson(`https://api.bilibili.com/x/v3/fav/resource/list?media_id=${srcFolder.id}&pn=${foState.page}&ps=${PS}&platform=web`);
    const medias = rj?.data?.medias || [];
    const total = rj?.data?.info?.media_count ?? medias.length;
    const targetFolders = folders.filter((f) => f.id !== srcFolder.id);

    body.innerHTML = '<p class="muted small">分析中（获取每个视频的标签）…</p>';
    const results = [];
    for (const m of medias) {
      let tags = [];
      try {
        const tj = await biliJson(`https://api.bilibili.com/x/tag/archive/tags?bvid=${m.bvid}`);
        tags = (tj?.data || []).map((t) => t.tag_name);
      } catch {}
      let match = null;
      for (const f of targetFolders) {
        const names = [f.title, ...(foState.aliases[f.title] || [])];
        if (tags.some((t) => names.some((n) => n && (n === t || t.includes(n) || n.includes(t))))) { match = f; break; }
      }
      const feats = bayesFeatures(m, tags);
      const bayesRes = match ? null : bayesPredict(feats);
      results.push({ media: m, tags, match, feats, bayesRes });
    }
    renderFolderOrganizer(results, srcFolder, targetFolders, folders, total, PS, foState.groups);
  } catch (e) {
    body.innerHTML = '<p class="muted small">加载失败：' + esc(e.message) + '</p>';
  }
}

function groupedFolderOptions(folders, groups, selectedId) {
  const grouped = new Set(Object.values(groups).flat());
  const opts = [];
  const selAttr = (fid) => (fid === selectedId ? " selected" : "");
  Object.entries(groups).forEach(([gname, fids]) => {
    if (!(fids || []).length) return;
    const groupOpts = (fids || []).map((fid) => {
      const f = folders.find((x) => x.id === fid);
      return f ? `<option value="${f.id}"${selAttr(f.id)}>${esc(f.title)}</option>` : "";
    }).join("");
    if (groupOpts) opts.push(`<optgroup label="${esc(gname)}">${groupOpts}</optgroup>`);
  });
  const ungrouped = folders.filter((f) => !grouped.has(f.id));
  const ungroupOpts = ungrouped.map((f) => `<option value="${f.id}"${selAttr(f.id)}>${esc(f.title)}</option>`).join("");
  if (ungroupOpts) opts.push(`<optgroup label="未分组">${ungroupOpts}</optgroup>`);
  return opts.join("");
}

function renderFolderOrganizer(results, srcFolder, targetFolders, allFolders, total, ps, groups) {
  const body = $("fo-body");
  body.innerHTML = "";
  const matched = results.filter((r) => r.match);
  const modeRow = el("div", "fo-toolbar");

  const srcSel = el("select", "fo-src-sel");
  srcSel.title = "选择要整理的收藏夹";
  srcSel.innerHTML = groupedFolderOptions(allFolders, groups, srcFolder.id);
  srcSel.addEventListener("change", () => {
    foState.srcId = srcSel.value;
    foState.page = 1;
    loadFolderOrganizer();
  });
  modeRow.appendChild(srcSel);

  const modeBtn = el("button", "fo-btn");
  modeBtn.textContent = foState.auto ? "🔄 切换为手动批准" : "⚡ 切换为自动(full access)";
  modeBtn.addEventListener("click", async () => {
    foState.auto = !foState.auto;
    await chrome.storage.local.set({ foAuto: foState.auto });
    loadFolderOrganizer();
  });
  modeRow.appendChild(modeBtn);
  const aliasBtn = el("button", "fo-btn", "🏷 管理文件夹别名");
  aliasBtn.addEventListener("click", manageFoAliases);
  modeRow.appendChild(aliasBtn);
  const learnBtn = el("button", "fo-btn", "🧠 查看学习内容");
  learnBtn.addEventListener("click", showBayesDetail);
  modeRow.appendChild(learnBtn);
  body.appendChild(modeRow);

  const stats = bayesStats();
  const totalPages = Math.max(1, Math.ceil(total / ps));
  body.appendChild(el("p", "fo-summary", `「${esc(srcFolder.title)}」共 ${total} 个视频（第 ${foState.page}/${totalPages} 页）· 可分类 ${matched.length} 个 · 🧠已学习 ${stats.docs} 次`));

  if (!results.length) { body.appendChild(el("p", "muted small", "默认收藏夹是空的。")); return; }

  results.forEach((r) => {
    const row = el("div", "fo-item");
    const aid = r.media.id || r.media.aid;
    let hint;
    if (r.match) hint = `<span class="fo-hint match">✓ 匹配</span>`;
    else if (r.bayesRes) hint = `<span class="fo-hint bayes">🧠AI建议 ${r.bayesRes.confidence}%</span>`;
    else hint = `<span class="fo-hint">无建议</span>`;
    const cover = (r.media.cover || "").replace(/^http:/, "https:");
    const bvid = r.media.bvid || "";
    const videoUrl = bvid ? `https://www.bilibili.com/video/${bvid}` : "#";
    row.innerHTML =
      `<a class="fo-cover-link" href="${videoUrl}" target="_blank" rel="noreferrer"><img class="fo-cover" loading="lazy" referrerpolicy="no-referrer" src="${esc(cover)}" alt=""></a>` +
      `<div class="fo-item-main"><div class="fo-item-title"><a class="fo-title-link" href="${videoUrl}" target="_blank" rel="noreferrer" title="打开视频">${esc(r.media.title)}</a> ${hint}</div>` +
      `<div class="fo-item-tags">标签：${(r.tags.map(esc).join("、") || "无")}</div></div>`;

    const sel = el("select", "fo-sel");
    const defId = r.match?.id || r.bayesRes?.id;
    sel.innerHTML = `<option value="">— 选择收藏夹 —</option>` + groupedFolderOptions(targetFolders, groups, defId);

    const delBtn = el("button", "fo-del");
    delBtn.textContent = "✕";
    delBtn.title = "取消收藏（从当前收藏夹删除）";
    delBtn.addEventListener("click", async () => {
      if (!confirm(`确认取消收藏？将从「${srcFolder.title}」删除「${r.media.title}」`)) return;
      delBtn.disabled = true; delBtn.textContent = "…";
      const res = await deleteBiliVideo(srcFolder.id, aid);
      if (res.ok) { row.remove(); }
      else { delBtn.disabled = false; delBtn.textContent = "✕"; delBtn.title = "删除失败:" + res.reason; alert("删除失败：" + res.reason); }
    });

    const btn = el("button", "fo-move");
    btn.textContent = "移动";
    const doMove = async () => {
      const fid = sel.value;
      if (!fid) { btn.textContent = "先选收藏夹"; setTimeout(() => (btn.textContent = "移动"), 1500); return; }
      btn.disabled = true; btn.textContent = "移动中…";
      const res = await moveBiliVideo(srcFolder.id, fid, aid, foState.mid);
      if (res.ok) { row.classList.add("done"); btn.textContent = "✅"; btn.disabled = true; sel.disabled = true; bayesTrain(fid, r.feats); }
      else { btn.textContent = "重试(" + res.reason + ")"; btn.disabled = false; }
    };
    btn.addEventListener("click", doMove);
    if (foState.auto && r.match) { sel.disabled = true; doMove(); }

    row.appendChild(delBtn);
    row.appendChild(sel);
    row.appendChild(btn);
    body.appendChild(row);
  });

  if (totalPages > 1) {
    const pager = el("div", "fo-pager");
    const prevBtn = el("button", "fo-btn", "‹ 上一页");
    prevBtn.disabled = foState.page <= 1;
    prevBtn.addEventListener("click", () => { if (foState.page > 1) { foState.page--; foState.pendingScroll = true; loadFolderOrganizer(); } });
    const nextBtn = el("button", "fo-btn", "下一页 ›");
    nextBtn.disabled = foState.page >= totalPages;
    nextBtn.addEventListener("click", () => { if (foState.page < totalPages) { foState.page++; foState.pendingScroll = true; loadFolderOrganizer(); } });
    pager.appendChild(prevBtn);
    pager.appendChild(el("span", "fo-page-num", `${foState.page} / ${totalPages}`));
    pager.appendChild(nextBtn);
    body.appendChild(pager);
  }

  if (foState.pendingScroll) {
    foState.pendingScroll = false;
    const card = $("fo-body")?.closest("section");
    if (card) card.scrollIntoView({ block: "start" });
  }
}

const foState = { aliases: {}, auto: false, mid: "", srcId: null, page: 1, pendingScroll: false, groups: {} };

// ---------- DeepSeek 对话（接入本机 harness，多轮 + 流式思维 + 切换模型） ----------
function initAiChat() {
  const list = $("ai-chat-list");
  const form = $("ai-chat-form");
  const input = $("ai-chat-input");
  const send = $("ai-chat-send");
  const modelSel = $("ai-chat-model");
  const effortSel = $("ai-chat-effort");
  const newBtn = $("ai-chat-new");
  const statusEl = $("ai-chat-status");
  const sessionsEl = $("ai-chat-sessions");
  const qBackdrop = $("ai-chat-question");
  const qTitle = $("ai-chat-question-title");
  const qText = $("ai-chat-question-text");
  const qBody = $("ai-chat-question-body");
  const qSkip = $("ai-chat-question-skip");
  const qSubmit = $("ai-chat-question-submit");
  const qClose = $("ai-chat-question-close");
  if (!list || !form || !input || !send) return;

  const chat = {
    sessionId: null,
    sinceSeq: -1,
    lastSentText: null,
    messages: [], // { role: "user"|"assistant", text?, blocks?, streaming? }
    streaming: false,
    models: null,
    current: null,
    stats: { turns: 0, steps: 0, inTok: 0, outTok: 0 },
  };

  // ---- 渲染辅助 ----
  const blocksOf = (msg) => msg.blocks || [];
  const textBlocks = (msg) => blocksOf(msg).filter((b) => b.kind === "text");
  const thinkBlocks = (msg) => blocksOf(msg).filter((b) => b.kind === "reasoning");
  const toolBlocks = (msg) => blocksOf(msg).filter((b) => b.kind === "tool-call");

  function scrollBottom() { list.scrollTop = list.scrollHeight; }

  function buildUserEl(msg) {
    const wrap = el("div", "ai-chat-msg user");
    const bubble = el("div", "ai-chat-bubble");
    bubble.textContent = msg.text || "";
    wrap.appendChild(bubble);
    return wrap;
  }

  function buildAssistantEl(msg) {
    const wrap = el("div", "ai-chat-msg assistant");
    const refs = { thinking: null, thinkingBody: null, text: null, tools: null };
    const think = thinkBlocks(msg).map((b) => b.text || "").join("\n");
    if (msg.streaming) {
      // 流式中：只显示一个固定高度的「思考中」指示，不刷屏显示思维全文
      const live = el("div", "ai-chat-thinking ai-chat-thinking-live");
      const label = el("span", "ai-chat-thinking-label");
      label.textContent = "💭 思考中";
      live.appendChild(label);
      wrap.appendChild(live);
      refs.thinking = live;
    } else if (think) {
      const details = el("details", "ai-chat-thinking");
      const summary = el("summary");
      summary.textContent = "💭 思考过程";
      const body = el("div", "ai-chat-thinking-body");
      body.textContent = think;
      details.appendChild(summary);
      details.appendChild(body);
      wrap.appendChild(details);
      refs.thinking = details;
      refs.thinkingBody = body;
    }
    const answer = textBlocks(msg).map((b) => b.text || "").join("\n");
    if (answer) {
      const textEl = el("div", "ai-chat-bubble");
      textEl.textContent = answer;
      wrap.appendChild(textEl);
      refs.text = textEl;
    } else if (msg.streaming) {
      const textEl = el("div", "ai-chat-bubble ai-chat-bubble-typing");
      textEl.textContent = "正在输入…";
      wrap.appendChild(textEl);
      refs.text = textEl;
    }
    const tools = toolBlocks(msg);
    if (tools.length) {
      const t = el("div", "ai-chat-tools");
      t.textContent = "🛠 " + tools.map((x) => x.name || "工具").join(" · ");
      wrap.appendChild(t);
      refs.tools = t;
    }
    return { root: wrap, refs };
  }

  function appendMessage(msg) {
    const dom = msg.role === "user" ? { root: buildUserEl(msg), refs: {} } : buildAssistantEl(msg);
    msg._dom = dom;
    list.appendChild(dom.root);
    scrollBottom();
    return dom;
  }

  // 把模型内容同步到 DOM
  function updateAssistantDom(msg) {
    const dom = msg._dom;
    if (!dom) return;
    if (!msg.streaming) {
      // 已结束：整块重建（思考从「思考中」指示切换成可展开的完整思考）
      const fresh = buildAssistantEl(msg);
      list.replaceChild(fresh.root, dom.root);
      msg._dom = fresh;
      scrollBottom();
      return;
    }
    // 流式中：只更新正文/工具，思考保持「思考中」指示（固定高度）
    const answer = textBlocks(msg).map((b) => b.text || "").join("\n");
    if (dom.refs.text) {
      dom.refs.text.textContent = answer || "正在输入…";
      dom.refs.text.classList.toggle("ai-chat-bubble-typing", !answer);
    }
    const tools = toolBlocks(msg);
    if (tools.length && !dom.refs.tools) {
      const fresh = buildAssistantEl(msg);
      list.replaceChild(fresh.root, dom.root);
      msg._dom = fresh;
      scrollBottom();
      return;
    }
    if (dom.refs.tools) dom.refs.tools.textContent = "🛠 " + tools.map((x) => x.name || "工具").join(" · ");
    scrollBottom();
  }

  function showError(text) {
    const wrap = el("div", "ai-chat-msg system");
    const b = el("div", "ai-chat-bubble");
    b.textContent = text;
    b.style.borderColor = "rgba(251,113,133,0.5)";
    b.style.color = "var(--muted)";
    wrap.appendChild(b);
    list.appendChild(wrap);
    scrollBottom();
  }

  function setBusy(busy) {
    send.disabled = busy;
    if (modelSel) modelSel.disabled = busy;
    if (effortSel) effortSel.disabled = busy;
    if (newBtn) newBtn.disabled = busy;
  }

  // ---- 事件折叠 ----
  function streamingAssistant() {
    const m = chat.messages[chat.messages.length - 1];
    return (m && m.role === "assistant" && m.streaming) ? m : null;
  }

  function startAssistant() {
    const m = { role: "assistant", blocks: [], streaming: true };
    chat.messages.push(m);
    appendMessage(m);
    return m;
  }

  function applyChunk(msg, chunk) {
    const idx = chunk.index;
    switch (chunk.type) {
      case "block-start":
        msg.blocks[idx] = { kind: chunk.blockType || "text", text: "" };
        break;
      case "text-delta": {
        const b = msg.blocks[idx] || { kind: "text", text: "" };
        b.kind = "text";
        b.text = (b.text || "") + (chunk.text || "");
        msg.blocks[idx] = b;
        break;
      }
      case "reasoning-delta": {
        const b = msg.blocks[idx] || { kind: "reasoning", text: "" };
        b.kind = "reasoning";
        b.text = (b.text || "") + (chunk.text || "");
        msg.blocks[idx] = b;
        break;
      }
      case "tool-call-delta": {
        const b = msg.blocks[idx] || { kind: "tool-call", name: "", argsRaw: "" };
        b.kind = "tool-call";
        b.name = chunk.name || b.name || "工具";
        b.argsRaw = (b.argsRaw || "") + (chunk.argumentsDelta || "");
        msg.blocks[idx] = b;
        break;
      }
      case "block-end": {
        const blk = chunk.block || {};
        msg.blocks[idx] = {
          kind: blk.type || "text",
          text: blk.text || "",
          name: blk.name,
          argsRaw: blk.argsRaw || blk.args || "",
        };
        break;
      }
    }
  }

  function applyEvent(ev) {
    switch (ev.type) {
      case "user/message": {
        const data = ev.data || {};
        // 只显示真正的用户消息，跳过系统注入的 runtime context / skill 目录等
        if (data.source && data.source.kind && data.source.kind !== "user") break;
        const content = data.content;
        const text = Array.isArray(content)
          ? content.filter((c) => c && c.type === "text").map((c) => c.text || "").join("\n")
          : "";
        if (!text) break;
        if (chat.lastSentText !== null && chat.lastSentText === text) {
          chat.lastSentText = null; // 本地已显示，跳过
          break;
        }
        const m = { role: "user", text };
        chat.messages.push(m);
        appendMessage(m);
        break;
      }
      case "assistant/chunk": {
        let m = streamingAssistant();
        if (!m) m = startAssistant();
        applyChunk(m, ev.data && ev.data.chunk);
        updateAssistantDom(m);
        break;
      }
      case "assistant/message": {
        const content = ev.data && ev.data.message && ev.data.message.content;
        let m = streamingAssistant();
        if (!m) m = startAssistant();
        if (Array.isArray(content)) {
          m.blocks = content.map((c) => ({
            kind: c.type || "text",
            text: c.text || "",
            name: c.name,
            argsRaw: c.argsRaw || c.args || "",
          }));
        }
        m.streaming = false;
        updateAssistantDom(m);
        if (ev.data && ev.data.usage) {
          chat.stats.inTok += ev.data.usage.inputTokens || 0;
          chat.stats.outTok += ev.data.usage.outputTokens || 0;
        }
        break;
      }
      case "step/end": {
        chat.stats.steps += 1;
        break;
      }
      case "turn/end": {
        const reason = ev.data && ev.data.reason && ev.data.reason.kind;
        if (ev.data && ev.data.turn) chat.stats.turns = Math.max(chat.stats.turns, ev.data.turn);
        const m = streamingAssistant();
        if (m) {
          m.streaming = false;
          updateAssistantDom(m);
        }
        if (reason && reason !== "completed") {
          const err = { role: "assistant", blocks: [{ kind: "text", text: `（这一轮被终止：${reason}）` }], streaming: false };
          chat.messages.push(err);
          appendMessage(err);
        }
        break;
      }
    }
  }

  function renderStatus() {
    if (!statusEl) return;
    const s = chat.stats;
    const cur = chat.current || {};
    let modelName = cur.model || "";
    const groups = (chat.models && chat.models.groups) || [];
    for (const g of groups) {
      for (const m of g.models || []) {
        if (g.id === cur.provider && m.id === cur.model) modelName = m.name || m.id;
      }
    }
    const parts = [];
    if (s.turns) parts.push(`${s.turns} 轮`);
    if (s.steps) parts.push(`${s.steps} 步`);
    if (modelName) parts.push(`${modelName}${cur.reasoningEffort ? " · " + cur.reasoningEffort : ""}`);
    if (s.outTok) parts.push(`输出 ${s.outTok} tok`);
    statusEl.textContent = parts.join(" ｜ ");
  }

  function applyEvents(events) {
    for (const e of events) {
      if (!e || !e.event) continue;
      if (e.event.seq > chat.sinceSeq) chat.sinceSeq = e.event.seq;
      applyEvent(e.event);
    }
    renderStatus();
  }

  // ---- 模型下拉 ----
  function renderModelSelects() {
    const groups = (chat.models && chat.models.groups) || [];
    const cur = chat.current || (chat.models && chat.models.current) || {};
    modelSel.innerHTML = "";
    for (const g of groups) {
      const og = document.createElement("optgroup");
      og.label = g.name || g.id;
      for (const m of g.models || []) {
        const opt = document.createElement("option");
        opt.value = g.id + "::" + m.id;
        opt.textContent = m.name || m.id;
        if (g.id === cur.provider && m.id === cur.model) opt.selected = true;
        og.appendChild(opt);
      }
      modelSel.appendChild(og);
    }
    effortSel.innerHTML = "";
    let curModel = null;
    for (const g of groups) {
      for (const m of g.models || []) {
        if (g.id === cur.provider && m.id === cur.model) curModel = m;
      }
    }
    const efforts = (curModel && curModel.reasoning && curModel.reasoning.efforts) || [];
    const curEffort = cur.reasoningEffort || (curModel && curModel.reasoning && curModel.reasoning.defaultEffort);
    if (efforts.length) {
      for (const ef of efforts) {
        const opt = document.createElement("option");
        opt.value = ef.id;
        opt.textContent = ef.name || ef.id;
        if (ef.id === curEffort) opt.selected = true;
        effortSel.appendChild(opt);
      }
    } else {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "默认";
      effortSel.appendChild(opt);
    }
  }

  async function selectModel(provider, model, reasoningEffort) {
    try {
      const res = await chrome.runtime.sendMessage({
        type: "aiChat", op: "selectModel", provider, model, reasoningEffort,
      });
      if (res && res.ok) {
        chat.models = res.models;
        chat.current = res.current;
        renderModelSelects();
        renderStatus();
      } else {
        showError("切换模型失败：" + ((res && res.error) || "未知错误"));
      }
    } catch (e) {
      showError("切换模型失败：" + ((e && e.message) || String(e)));
    }
  }

  // ---- 会话栏（工作区 / 会话列表） ----
  function sessionTitle(s) {
    return (s.projections && s.projections.values && s.projections.values.title) || s.title || "";
  }

  function sessionBtn(s, currentId) {
    const btn = el("button", "ai-chat-sess" + (s.sessionId === currentId ? " on" : ""));
    btn.type = "button";
    btn.title = sessionTitle(s) || "(无标题)";
    const dot = el("span", "dot" + (s.running ? " running" : ""));
    const tt = el("span", "tt");
    tt.textContent = sessionTitle(s) || "(无标题)";
    btn.appendChild(dot);
    btn.appendChild(tt);
    btn.addEventListener("click", () => switchSession(s.sessionId));
    return btn;
  }

  function renderSidebar(data) {
    if (!sessionsEl) return;
    const sessions = data.sessions || [];
    const workspaces = data.workspaces || [];
    const currentId = data.currentSessionId || "";
    const byId = new Map(sessions.map((s) => [s.sessionId, s]));
    const placed = new Set();
    sessionsEl.innerHTML = "";

    for (const ws of workspaces) {
      const head = el("div", "ai-chat-ws");
      head.textContent = "📁 " + (ws.title || ws.path || "未命名");
      sessionsEl.appendChild(head);
      const ids = (ws.sessionIds || [])
        .map((id) => byId.get(id))
        .filter(Boolean)
        .filter((s) => !s.blank || s.sessionId === currentId)
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      for (const s of ids) {
        placed.add(s.sessionId);
        sessionsEl.appendChild(sessionBtn(s, currentId));
      }
    }

    const uncategorized = sessions
      .filter((s) => !placed.has(s.sessionId) && (!s.blank || s.sessionId === currentId))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    if (uncategorized.length) {
      const head = el("div", "ai-chat-ws");
      head.textContent = "未分组";
      sessionsEl.appendChild(head);
      for (const s of uncategorized) sessionsEl.appendChild(sessionBtn(s, currentId));
    }
  }

  async function loadSidebar() {
    try {
      const res = await chrome.runtime.sendMessage({ type: "aiChat", op: "sessions" });
      if (res && res.ok) renderSidebar(res);
    } catch (e) {
      // 侧栏加载失败不阻塞主流程
    }
  }

  async function switchSession(sessionId) {
    if (!sessionId || sessionId === chat.sessionId || chat.streaming) return;
    try {
      const res = await chrome.runtime.sendMessage({ type: "aiChat", op: "switchSession", sessionId });
      if (!res || !res.ok) throw new Error((res && res.error) || "切换失败");
      chat.sessionId = sessionId;
      chat.sinceSeq = -1;
      chat.lastSentText = null;
      chat.messages = [];
      chat.stats = { turns: 0, steps: 0, inTok: 0, outTok: 0 };
      list.innerHTML = `<p class="muted small">加载会话…</p>`;
      const sync = await chrome.runtime.sendMessage({ type: "aiChat", op: "sync", sinceSeq: -1 });
      if (sync && sync.ok) {
        chat.models = sync.models;
        chat.current = sync.current;
        renderModelSelects();
        list.innerHTML = "";
        applyEvents(sync.events || []);
        if (sync.maxSeq != null) chat.sinceSeq = sync.maxSeq;
        if (chat.messages.length === 0) list.innerHTML = `<p class="muted small">空会话，发条消息开始吧。</p>`;
      } else {
        showError("加载会话失败：" + ((sync && sync.error) || "未知错误"));
      }
      loadSidebar();
    } catch (e) {
      showError("切换会话失败：" + ((e && e.message) || String(e)));
    }
  }

  // ---- ask_user_question 提问 ----
  let pendingQuestion = null; // { rpcId, sessionId, questions }
  let muxSocket = null;
  let muxTimer = null;

  function hideQuestion() {
    pendingQuestion = null;
    if (qBackdrop) qBackdrop.hidden = true;
  }

  function showQuestion(q) {
    pendingQuestion = q;
    if (!qBackdrop || !qBody) return;
    const questions = q.questions || [];
    if (qTitle) qTitle.textContent = (questions[0] && questions[0].header) || "提问";
    if (qText) qText.textContent = questions[0] ? questions[0].question : "";
    qBody.innerHTML = "";
    for (const item of questions) {
      const itemEl = el("div", "ai-chat-q-item");
      const qLabel = el("div");
      qLabel.textContent = item.question || "";
      itemEl.appendChild(qLabel);
      const selected = new Set();
      const options = item.options || [];
      for (const opt of options) {
        const optEl = el("div", "ai-chat-q-opt");
        const no = el("span", "no");
        const txt = el("div");
        txt.innerHTML = `<div>${esc(opt.label)}</div>${opt.description ? `<div class="ai-chat-q-desc">${esc(opt.description)}</div>` : ""}`;
        optEl.appendChild(no);
        optEl.appendChild(txt);
        optEl.addEventListener("click", () => {
          if (item.multiSelect) {
            if (selected.has(opt.label)) {
              selected.delete(opt.label); optEl.classList.remove("sel"); no.textContent = "";
            } else {
              selected.add(opt.label); optEl.classList.add("sel"); no.textContent = "✓";
            }
          } else {
            itemEl.querySelectorAll(".ai-chat-q-opt").forEach((o) => {
              o.classList.remove("sel"); o.querySelector(".no").textContent = "";
            });
            selected.clear();
            selected.add(opt.label);
            optEl.classList.add("sel");
            no.textContent = "✓";
          }
        });
        itemEl.appendChild(optEl);
      }
      const custom = el("textarea", "ai-chat-q-custom");
      custom.rows = 1;
      custom.placeholder = "📝 输入你的答案（可选）";
      itemEl.appendChild(custom);
      itemEl._data = { item, selected, custom };
      qBody.appendChild(itemEl);
    }
    qBackdrop.hidden = false;
  }

  async function submitQuestion() {
    const q = pendingQuestion;
    if (!q) return;
    const answers = [];
    qBody.querySelectorAll(".ai-chat-q-item").forEach((itemEl) => {
      const d = itemEl._data;
      const customText = (d.custom.value || "").trim();
      const ans = { id: d.item.id, selected: Array.from(d.selected) };
      if (customText) ans.custom = customText;
      answers.push(ans);
    });
    hideQuestion();
    try {
      const res = await chrome.runtime.sendMessage({
        type: "aiChat", op: "answerQuestion",
        rpcId: q.rpcId, sessionId: q.sessionId, answer: { answers },
      });
      if (!res || !res.ok) showError("回答提交失败：" + ((res && res.error) || "未知错误"));
    } catch (e) {
      showError("回答提交失败：" + ((e && e.message) || String(e)));
    }
  }

  async function skipQuestion() {
    const q = pendingQuestion;
    if (!q) return;
    hideQuestion();
    try {
      const res = await chrome.runtime.sendMessage({ type: "aiChat", op: "skipQuestion", rpcId: q.rpcId });
      if (!res || !res.ok) showError("跳过失败：" + ((res && res.error) || "未知错误"));
    } catch (e) {
      showError("跳过失败：" + ((e && e.message) || String(e)));
    }
  }

  function connectMux() {
    if (muxSocket || muxTimer) return;
    try {
      muxSocket = new WebSocket("ws://127.0.0.1:3080/api/events.mux");
      muxSocket.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg && msg.type === "server-request" && msg.method === "question/requested") {
          const p = msg.payload || {};
          if (p.sessionId && p.sessionId === chat.sessionId) {
            showQuestion({ rpcId: msg.rpcId, sessionId: p.sessionId, questions: p.questions || [] });
          }
        }
      };
      muxSocket.onclose = () => {
        muxSocket = null;
        muxTimer = setTimeout(() => { muxTimer = null; connectMux(); }, 5000);
      };
      muxSocket.onerror = () => { try { muxSocket && muxSocket.close(); } catch {} };
    } catch (e) {
      muxTimer = setTimeout(() => { muxTimer = null; connectMux(); }, 5000);
    }
  }

  // ---- 发送 ----
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function autoResize() {
    input.style.height = "auto";
    input.style.height = Math.min(160, input.scrollHeight) + "px";
  }

  // 由页面驱动轮询：每次用短促的 sendMessage 唤醒 SW 做一件事即返回，
  // 即使 SW 在两次轮询之间被回收也不影响（下次 sendMessage 会重新唤醒它）。
  async function sendMessage() {
    const text = input.value.trim();
    if (!text || chat.streaming) return;
    input.value = "";
    autoResize();

    const userMsg = { role: "user", text };
    chat.messages.push(userMsg);
    appendMessage(userMsg);
    chat.lastSentText = text;

    chat.streaming = true;
    setBusy(true);
    try {
      const sent = await chrome.runtime.sendMessage({ type: "aiChat", op: "send", text, sinceSeq: chat.sinceSeq });
      if (!sent || !sent.ok) throw new Error((sent && sent.error) || "发送失败");

      const deadline = Date.now() + 10 * 60 * 1000;
      while (Date.now() < deadline) {
        await sleep(800);
        const p = await chrome.runtime.sendMessage({ type: "aiChat", op: "poll", sinceSeq: chat.sinceSeq });
        if (!p || !p.ok) throw new Error((p && p.error) || "轮询失败");
        applyEvents(p.events || []);
        if (p.done) break;
      }
      if (Date.now() >= deadline) showError("生成超时（超过 10 分钟）。");
    } catch (e) {
      showError("对话出错：" + ((e && e.message) || String(e)) + "。请确认本机 harness 正在运行（dsh web）。");
    } finally {
      chat.streaming = false;
      setBusy(false);
    }
  }

  // ---- 初始化 / 事件绑定 ----
  if (qSubmit) qSubmit.addEventListener("click", submitQuestion);
  if (qSkip) qSkip.addEventListener("click", skipQuestion);
  if (qClose) qClose.addEventListener("click", hideQuestion);
  form.addEventListener("submit", (ev) => { ev.preventDefault(); sendMessage(); });
  input.addEventListener("input", autoResize);
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); sendMessage(); }
  });
  modelSel.addEventListener("change", () => {
    const parts = modelSel.value.split("::");
    if (parts.length === 2) selectModel(parts[0], parts[1]);
  });
  effortSel.addEventListener("change", () => {
    const parts = modelSel.value.split("::");
    if (parts.length === 2) selectModel(parts[0], parts[1], effortSel.value || undefined);
  });
  newBtn.addEventListener("click", async () => {
    if (!confirm("开启新对话？当前对话会保留在 harness 里，但本页不再显示。")) return;
    try {
      const res = await chrome.runtime.sendMessage({ type: "aiChat", op: "newSession" });
      if (res && res.ok) {
        chat.sessionId = res.sessionId;
        chat.sinceSeq = -1;
        chat.lastSentText = null;
        chat.messages = [];
        chat.models = res.models;
        chat.current = res.current;
        chat.stats = { turns: 0, steps: 0, inTok: 0, outTok: 0 };
        renderModelSelects();
        renderStatus();
        list.innerHTML = `<p class="muted small">新对话已开启。</p>`;
        loadSidebar();
      } else {
        showError("新对话失败：" + ((res && res.error) || "未知错误"));
      }
    } catch (e) {
      showError("新对话失败：" + ((e && e.message) || String(e)));
    }
  });

  (async function init() {
    try {
      const res = await chrome.runtime.sendMessage({ type: "aiChat", op: "sync", sinceSeq: -1 });
      list.innerHTML = "";
      if (res && res.ok) {
        chat.sessionId = res.sessionId;
        chat.models = res.models;
        chat.current = res.current;
        renderModelSelects();
        applyEvents(res.events || []);
        if (res.maxSeq != null) chat.sinceSeq = res.maxSeq;
        if (chat.messages.length === 0) {
          list.innerHTML = `<p class="muted small">已连接 DeepSeek。随便聊，或粘贴视频字幕让它分析。</p>`;
        }
        loadSidebar();
        connectMux();
      } else {
        showError("无法连接 DeepSeek Harness：" + ((res && res.error) || "未知错误") + "。请确认本机 harness 正在运行（dsh web）。");
      }
    } catch (e) {
      list.innerHTML = "";
      showError("无法连接 DeepSeek Harness：" + ((e && e.message) || String(e)) + "。请确认本机 harness 正在运行（dsh web）。");
    }
  })();
}

// ---------- boot ----------

async function boot() {
  initTheme();
  initPageSwitch();
  tick();
  setInterval(tick, 1000);
  initSearch();
  await initLaunchers();
  const cfg = await getCfg();
  applyHomeModules(cfg);
  watchHomeModuleSettings(cfg);
  loadAiHot();
  loadTrending();
  $("aihot-refresh").addEventListener("click", loadAiHot);
  loadGitHub(cfg.ghUser, cfg.ghToken);
  loadVps(cfg.vpsUrl);
  loadTraffic();
  setInterval(loadTraffic, 300000);
  initSrtTool();
  initAiChat();
  loadFolderOrganizer();
  loadBiliWorkbench();
  loadSubfolderManager();
  initFmTabs();
  initTreeDrag();
  if (cfg.vpsUrl) setInterval(() => loadVps(cfg.vpsUrl), 15000);
  $("todo-refresh").addEventListener("click", () => {
    if (homeModulePrefs.showTodo) loadTodos(cfg.todoistToken);
  });

  // 页面不可见时暂停背景视频/动画，回到前台再恢复
  document.addEventListener("visibilitychange", () => {
    const media = $("hero-background-media");
    if (!media) return;
    media.querySelectorAll("video").forEach((v) => {
      if (document.hidden) v.pause();
      else if (v.paused) v.play().catch(() => {});
    });
  });
}
boot();

