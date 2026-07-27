"use strict";

// ---------- storage ----------
function getCfg() {
  return new Promise((res) => chrome.storage.local.get(["todoistToken", "ghUser", "ghToken", "vpsUrl"], res));
}
const DEFAULT_VPS = "https://logicweaver.me/vps/stats";

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

// ---------- GitHub ----------
async function loadGitHub(user, token) {
  const body = $("gh-body");
  const headers = { Accept: "application/vnd.github+json" };
  let url;
  if (token) {
    headers.Authorization = "Bearer " + token;
    url = "https://api.github.com/user/starred?per_page=24";
    if (user) $("gh-user").textContent = user;
  } else if (user) {
    url = `https://api.github.com/users/${encodeURIComponent(user)}/starred?per_page=24`;
    $("gh-user").textContent = user;
  } else {
    body.innerHTML = `<p class="notice">未配置 GitHub。到 <a href="options.html" target="_blank">设置</a> 填用户名（可选 Token）。</p>`;
    return;
  }
  body.innerHTML = `<p class="muted small">加载中…</p>`;
  try {
    const r = await fetch(url, { headers });
    if (!r.ok) throw new Error();
    const repos = await r.json();
    if (!repos.length) {
      body.innerHTML = `<p class="muted small">没有 star。</p>`;
      return;
    }
    const grid = el("div", "repos");
    repos.forEach((rp) => {
      const a = el("a", "repo");
      a.href = rp.html_url;
      a.target = "_blank";
      a.rel = "noreferrer";
      a.innerHTML =
        `<div class="name"><span class="owner">${esc(rp.owner?.login)}/</span>${esc(rp.name)}</div>` +
        (rp.description ? `<p class="desc">${esc(rp.description)}</p>` : "") +
        `<div class="meta">${rp.language ? `<span>${esc(rp.language)}</span>` : ""}<span>★ ${rp.stargazers_count ?? 0}</span></div>`;
      grid.appendChild(a);
    });
    body.innerHTML = "";
    body.appendChild(grid);
  } catch {
    body.innerHTML = `<p class="notice">GitHub 加载失败（频率限制或 Token 无效）。</p>`;
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

// ---------- boot ----------
async function boot() {
  tick();
  setInterval(tick, 1000);
  const cfg = await getCfg();
  loadBili();
  loadTodos(cfg.todoistToken);
  loadGitHub(cfg.ghUser, cfg.ghToken);
  const vpsUrl = cfg.vpsUrl || DEFAULT_VPS;
  loadVps(vpsUrl);
  setInterval(() => loadVps(vpsUrl), 15000);
  $("todo-refresh").addEventListener("click", () => loadTodos(cfg.todoistToken));
}
boot();
