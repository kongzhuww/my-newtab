"use strict";
// 塞壬电台 (Monster Siren) player + Bilibili MV mini-TV. Direct fetch (the
// extension has host permissions, so no CORS/proxy needed).
(function () {
  const API = "https://monster-siren.hypergryph.com/api";
  const IDLE = { queue: [], index: -1 };
  let albums = [], albumsLoaded = false, allSongs = [], current = null, playing = false;
  let lyrics = [], mode = "shuffle", lyricIndex = -2, lastTopLyric = "", lastProgressSecond = -1;
  const audio = new Audio();

  const $ = (s, r = document) => r.querySelector(s);
  const mk = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };
  const https = (u) => (u ? u.replace(/^http:\/\//, "https://") : u);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const fmt = (s) => { if (!isFinite(s) || s < 0) s = 0; const m = Math.floor(s / 60); return m + ":" + String(Math.floor(s % 60)).padStart(2, "0"); };
  async function api(path) { const r = await fetch(API + path, { headers: { Accept: "application/json" } }); const j = await r.json(); return j && j.data !== undefined ? j.data : j; }

  // ---- DOM ----
  const launch = mk("button", "tb-pill", "🎵 塞壬电台");
  const panel = mk("div", "ms-panel");
  panel.style.display = "none";
  panel.innerHTML =
    '<header><span>🎵 塞壬电台</span><span class="ms-grow"></span><button class="ms-mv" title="MV 小电视">📺</button><button class="ms-back" style="display:none">← 专辑</button><button class="ms-close">✕</button></header>' +
    '<div class="ms-browse"></div>' +
    '<div class="ms-now" style="display:none">' +
    '<div class="ms-lyric"></div>' +
    '<div class="ms-nrow"><img class="ms-cover" referrerpolicy="no-referrer"><div class="ms-meta"><div class="ms-title"></div><div class="ms-artist"></div></div>' +
    '<button class="ms-prev">⏮</button><button class="ms-play">▶</button><button class="ms-next">⏭</button><button class="ms-mode" title="播放模式">🔀</button></div>' +
    '<div class="ms-prow"><span class="ms-cur">0:00</span><input class="ms-seek" type="range" min="0" max="100" value="0"><span class="ms-dur">0:00</span></div></div>';
  const tv = mk("div", "ms-tv");
  tv.style.display = "none";
  tv.innerHTML = '<div class="ms-tv-head"><span class="ms-tv-title">明日方舟 MV</span><button class="ms-tv-close">✕</button></div><div class="ms-tv-screen"></div>';
  const topPlayer = mk("div", "ms-top-player");
  topPlayer.hidden = true;
  topPlayer.innerHTML =
    '<div class="ms-top-side"><button class="ms-top-prev" title="上一首">⏮</button><button class="ms-top-play" title="播放/暂停">▶</button></div>' +
    '<button class="ms-top-main" title="打开塞壬电台"><span class="ms-top-title">塞壬电台</span><span class="ms-top-lyric">选择歌曲后在这里显示歌词</span></button>' +
    '<div class="ms-top-side"><button class="ms-top-next" title="下一首">⏭</button><button class="ms-top-open" title="打开歌单">🎵</button></div>';
  (document.getElementById("tb-launchers") || document.body).append(launch);
  const topbar = $(".topbar");
  if (topbar) topbar.insertBefore(topPlayer, $(".tb-actions", topbar));
  else document.body.append(topPlayer);
  document.body.append(panel, tv);

  const browse = $(".ms-browse", panel), now = $(".ms-now", panel), backBtn = $(".ms-back", panel);
  const panelLyric = $(".ms-lyric", panel), panelPlay = $(".ms-play", panel), curText = $(".ms-cur", panel), durText = $(".ms-dur", panel), seek = $(".ms-seek", panel);
  const topTitle = $(".ms-top-title", topPlayer), topLyric = $(".ms-top-lyric", topPlayer), topPlay = $(".ms-top-play", topPlayer);

  function makeDraggable(element, handle, minVisibleWidth, minVisibleHeight) {
    let drag = null;
    handle.classList.add("ms-drag-handle");

    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.target.closest("button")) return;
      const rect = element.getBoundingClientRect();
      drag = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
      handle.setPointerCapture(event.pointerId);
      event.preventDefault();
    });

    handle.addEventListener("pointermove", (event) => {
      if (!drag) return;
      const left = drag.left + event.clientX - drag.x;
      const top = drag.top + event.clientY - drag.y;
      element.style.left = Math.max(0, Math.min(window.innerWidth - minVisibleWidth, left)) + "px";
      element.style.top = Math.max(0, Math.min(window.innerHeight - minVisibleHeight, top)) + "px";
      element.style.right = "auto";
      element.style.bottom = "auto";
      element.style.transform = "none";
    });

    const stopDragging = () => { drag = null; };
    handle.addEventListener("pointerup", stopDragging);
    handle.addEventListener("pointercancel", stopDragging);
  }

  makeDraggable(panel, $("header", panel), 160, 80);
  makeDraggable(tv, $(".ms-tv-head", tv), 120, 80);

  // ---- data / playback ----
  async function loadAlbums() {
    if (albumsLoaded) return;
    browse.innerHTML = '<p class="ms-hint">加载中…</p>';
    try {
      albums = await api("/albums"); albumsLoaded = true;
      api("/songs").then((d) => { allSongs = d.list || []; }).catch(() => {});
      renderAlbums();
    } catch { browse.innerHTML = '<p class="ms-hint">加载失败</p>'; }
  }
  function renderAlbums() {
    backBtn.style.display = "none";
    browse.innerHTML = "";
    const g = mk("div", "ms-albums");
    albums.forEach((a) => {
      const b = mk("button", "ms-album");
      b.innerHTML = `<img loading="lazy" referrerpolicy="no-referrer" src="${esc(https(a.coverUrl))}"><span>${esc(a.name)}</span>`;
      b.onclick = () => openAlbum(a);
      g.appendChild(b);
    });
    browse.appendChild(g);
  }
  async function openAlbum(a) {
    backBtn.style.display = "";
    browse.innerHTML = '<p class="ms-hint">加载中…</p>';
    try {
      const d = await api(`/album/${a.cid}/detail`);
      browse.innerHTML = "";
      (d.songs || []).forEach((s) => {
        const b = mk("button", "ms-song");
        b.textContent = s.name;
        b.onclick = () => playCid(s.cid);
        if (current && current.cid === s.cid) b.classList.add("active");
        browse.appendChild(b);
      });
    } catch { browse.innerHTML = '<p class="ms-hint">加载失败</p>'; }
  }
  function artistText() { return current ? ((current.artists || []).join(", ") || "Monster Siren") : "Monster Siren"; }
  function setTopLyric(text) {
    const nextText = "♬ " + artistText() + (text ? " · " + text : "");
    if (nextText !== lastTopLyric) { topLyric.textContent = nextText; lastTopLyric = nextText; }
  }
  function togglePanel() { panel.style.display = panel.style.display === "none" ? "flex" : "none"; if (panel.style.display === "flex") loadAlbums(); }

  async function playCid(cid) {
    try {
      const d = await api(`/song/${cid}`);
      current = d; IDLE.index = allSongs.findIndex((s) => s.cid === cid);
      audio.src = d.sourceUrl; audio.play().catch(() => {});
      now.style.display = "block";
      topPlayer.hidden = false;
      $(".ms-title", panel).textContent = d.name;
      $(".ms-artist", panel).textContent = artistText();
      topTitle.textContent = d.name;
      setTopLyric("");
      $(".ms-cover", panel).src = https(d.coverUrl || "");
      loadLyric(d.lyricUrl);
      if (tv.style.display !== "none") loadMV(d.name);
      renderModeBtn();
    } catch {}
  }
  function next() {
    const n = allSongs.length; if (!n) return;
    let i = mode === "shuffle" && n > 1 ? (() => { let x = IDLE.index; while (x === IDLE.index) x = Math.floor(Math.random() * n); return x; })() : (IDLE.index + 1) % n;
    playCid(allSongs[i].cid);
  }
  function prev() { const n = allSongs.length; if (!n) return; playCid(allSongs[(IDLE.index - 1 + n) % n].cid); }

  // ---- lyrics ----
  async function loadLyric(url) {
    lyrics = []; lyricIndex = -2; panelLyric.textContent = ""; setTopLyric("");
    if (!url) { setTopLyric("纯音乐"); return; }
    try {
      const txt = await (await fetch(https(url))).text();
      lyrics = [];
      txt.split(/\r?\n/).forEach((line) => {
        const stamps = [...line.matchAll(/\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
        const text = line.replace(/\[[^\]]*\]/g, "").trim();
        if (stamps.length && text) stamps.forEach((g) => lyrics.push({ t: +g[1] * 60 + +g[2] + (g[3] ? +("0." + g[3]) : 0), text }));
      });
      lyrics.sort((a, b) => a.t - b.t);
    } catch {}
  }
  function isCredit(t) { return /(作曲|作词|编曲|演唱|混音|母带|制作|Vocal|Compos|Arrang|Lyric|Mix|Master)/i.test(t); }
  function tickLyric() {
    if (!lyrics.length) return;
    let li = lyricIndex;
    if (li < -1 || li >= lyrics.length || lyrics[Math.max(li, 0)]?.t > audio.currentTime + 0.2) li = -1;
    while (li + 1 < lyrics.length && lyrics[li + 1].t <= audio.currentTime + 0.2) li++;
    if (li === lyricIndex) return;
    lyricIndex = li;
    const real = lyrics.some((l) => !isCredit(l.text));
    const line = real ? (li >= 0 ? lyrics[li].text : "♪") : "纯音乐";
    panelLyric.textContent = line;
    setTopLyric(line);
  }

  // ---- MV (bilibili) ----
  async function loadMV(nameHint) {
    const screen = $(".ms-tv-screen", tv);
    screen.innerHTML = '<div class="ms-hint">搜索 MV…</div>';
    try {
      const r = await fetch(`https://api.bilibili.com/x/web-interface/search/type?search_type=video&page=1&keyword=${encodeURIComponent(nameHint + " 明日方舟")}`, { credentials: "include", headers: { Accept: "application/json" } });
      const j = await r.json();
      const list = (j?.data?.result || []).filter((v) => v.bvid);
      const off = list.find((v) => v.mid === 161775300 || ["明日方舟", "塞壬唱片-MSR", "塞壬唱片"].includes(v.author));
      const byPlay = [...list].sort((a, b) => (b.play || 0) - (a.play || 0));
      const pick = off || byPlay[0];
      if (!pick) { screen.innerHTML = '<div class="ms-hint">没找到 MV</div>'; return; }
      screen.innerHTML = `<iframe src="https://player.bilibili.com/player.html?bvid=${pick.bvid}&autoplay=1&high_quality=1&danmaku=0" scrolling="no" frameborder="0" allow="autoplay; fullscreen" allowfullscreen></iframe>`;
    } catch { screen.innerHTML = '<div class="ms-hint">MV 加载失败</div>'; }
  }

  // ---- controls ----
  function renderModeBtn() { $(".ms-mode", panel).textContent = mode === "shuffle" ? "🔀" : mode === "one" ? "🔂" : "🔁"; }
  panelPlay.onclick = () => { if (audio.paused) audio.play(); else audio.pause(); };
  $(".ms-prev", panel).onclick = prev;
  $(".ms-next", panel).onclick = next;
  $(".ms-mode", panel).onclick = () => { mode = mode === "shuffle" ? "list" : mode === "list" ? "one" : "shuffle"; renderModeBtn(); };
  seek.oninput = (e) => { if (audio.duration) audio.currentTime = (e.target.value / 100) * audio.duration; lyricIndex = -2; };
  $(".ms-back", panel).onclick = renderAlbums;
  $(".ms-close", panel).onclick = () => (panel.style.display = "none");
  $(".ms-mv", panel).onclick = () => { tv.style.display = tv.style.display === "none" ? "block" : "none"; if (tv.style.display === "block" && current) loadMV(current.name); };
  $(".ms-tv-close", tv).onclick = () => (tv.style.display = "none");
  launch.onclick = togglePanel;
  $(".ms-top-main", topPlayer).onclick = togglePanel;
  $(".ms-top-open", topPlayer).onclick = togglePanel;
  $(".ms-top-play", topPlayer).onclick = () => { if (audio.paused) audio.play(); else audio.pause(); };
  $(".ms-top-prev", topPlayer).onclick = prev;
  $(".ms-top-next", topPlayer).onclick = next;

  audio.addEventListener("play", () => { playing = true; panelPlay.textContent = "⏸"; topPlay.textContent = "⏸"; });
  audio.addEventListener("pause", () => { playing = false; panelPlay.textContent = "▶"; topPlay.textContent = "▶"; });
  audio.addEventListener("ended", () => { if (mode === "one") { audio.currentTime = 0; audio.play(); } else next(); });
  audio.addEventListener("timeupdate", () => {
    const second = Math.floor(audio.currentTime);
    if (panel.style.display !== "none" && second !== lastProgressSecond) {
      lastProgressSecond = second;
      curText.textContent = fmt(audio.currentTime);
      durText.textContent = fmt(audio.duration);
      seek.value = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0;
    }
    tickLyric();
  });
})();
