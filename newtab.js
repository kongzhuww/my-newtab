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
const gh = { repos: [], cats: [], map: {}, active: "全部", UNCAT: "未分类" };
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
  if (!url) { body.innerHTML = `<p class="notice">未配置 VPS。到 <a href="options.html">设置</a> 填探针地址（返回 stats JSON 的 HTTPS 接口）。</p>`; return; }
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

// ---------- browser shortcuts + bookmarks ----------
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
  img.src = favi(link.url);
  img.alt = "";
  img.addEventListener("load", () => (fallback.style.display = "none"));
  img.addEventListener("error", () => (img.style.display = "none"));
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
  $("launcher-folder-dialog").showModal();
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
  if (cfg.vpsUrl) setInterval(() => loadVps(cfg.vpsUrl), 15000);
  $("todo-refresh").addEventListener("click", () => {
    if (homeModulePrefs.showTodo) loadTodos(cfg.todoistToken);
  });
}
boot();
