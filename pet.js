"use strict";
// Arknights Spine desktop pet for the new-tab page.
// The Spine runtime (vendor/spine-player.js) must be bundled locally — MV3
// forbids loading it from a CDN. Models are fetched from jsDelivr at runtime.
(function () {
  const CDN = "https://cdn.jsdelivr.net/gh/isHarryh/Ark-Models@main";
  const CUR_KEY = "lw-pet-current";
  const IDLE = ["Relax", "Idle", "Sit", "Interact_1", "Interact"];
  const ACT = ["Interact", "Interact_1", "Special", "Attack", "Sleep"];

  let models = [];
  let modelsState = "idle";
  let player = null;
  let idleAnim = "Relax";
  const drag = { on: false, sx: 0, sy: 0, ox: 0, oy: 0, moved: false };

  // ---- DOM ----
  const launcher = document.createElement("button");
  launcher.id = "pet-launch";
  launcher.title = "选择明日方舟桌宠";
  launcher.textContent = "🐧";

  const host = document.createElement("div");
  host.id = "pet-host";
  host.style.display = "none";

  const picker = document.createElement("div");
  picker.id = "pet-picker";
  picker.style.display = "none";
  picker.innerHTML =
    '<div class="pet-backdrop"></div>' +
    '<div class="pet-panel"><header><span>🐧 选择干员桌宠</span><button class="pet-close">✕</button></header>' +
    '<input class="pet-search" placeholder="搜索干员名…" />' +
    '<div class="pet-list"><p class="pet-hint">加载中…</p></div></div>';

  document.body.appendChild(launcher);
  document.body.appendChild(host);
  document.body.appendChild(picker);

  const listEl = picker.querySelector(".pet-list");
  const searchEl = picker.querySelector(".pet-search");

  // ---- models ----
  async function ensureModels() {
    if (modelsState === "ready" || modelsState === "loading") return;
    modelsState = "loading";
    try {
      const r = await fetch(`${CDN}/models_data.json`);
      const j = await r.json();
      const data = j.data || {};
      models = Object.entries(data)
        .filter(([, m]) => m && m.type === "Operator" && m.style === "BuildingDefault" && m.assetList && m.assetList[".skel"] && m.assetList[".atlas"])
        .map(([key, m]) => ({ key, name: m.name, skel: `${CDN}/models/${key}/${m.assetList[".skel"]}`, atlas: `${CDN}/models/${key}/${m.assetList[".atlas"]}` }))
        .sort((a, b) => a.name.localeCompare(b.name, "zh"));
      modelsState = "ready";
    } catch {
      modelsState = "error";
    }
  }

  function renderList(q) {
    if (modelsState === "loading") { listEl.innerHTML = '<p class="pet-hint">加载干员列表…</p>'; return; }
    if (modelsState === "error") { listEl.innerHTML = '<p class="pet-hint">列表加载失败,稍后再试。</p>'; return; }
    const kw = (q || "").trim().toLowerCase();
    const list = (kw ? models.filter((m) => m.name.toLowerCase().includes(kw)) : models).slice(0, 80);
    if (!list.length) { listEl.innerHTML = '<p class="pet-hint">没有匹配的干员。</p>'; return; }
    listEl.innerHTML = "";
    list.forEach((m) => {
      const b = document.createElement("button");
      b.className = "pet-item";
      b.textContent = m.name;
      b.addEventListener("click", () => pick(m));
      listEl.appendChild(b);
    });
  }

  async function openPicker() {
    picker.style.display = "block";
    await ensureModels();
    renderList(searchEl.value);
  }
  function closePicker() { picker.style.display = "none"; }

  function pick(m) {
    closePicker();
    try { localStorage.setItem(CUR_KEY, JSON.stringify(m)); } catch {}
    loadModel(m);
  }

  function loadModel(m) {
    launcher.style.display = "none";
    host.style.display = "block";
    if (!window.spine || !window.spine.SpinePlayer) {
      host.innerHTML = '<div class="pet-missing">缺少 Spine 运行时<br>请把 spine-player.js 放到 vendor/</div>';
      return;
    }
    try { player && player.dispose && player.dispose(); } catch {}
    host.innerHTML = "";
    player = new window.spine.SpinePlayer(host, {
      skelUrl: m.skel, atlasUrl: m.atlas,
      premultipliedAlpha: true, alpha: true, backgroundColor: "#00000000",
      showControls: false, showLoading: false,
      success: (p) => {
        try {
          const anims = p.skeleton.data.animations.map((a) => a.name);
          idleAnim = IDLE.find((n) => anims.includes(n)) || anims[0];
          p.animationState.setAnimation(0, idleAnim, true);
        } catch {}
      },
      error: () => { host.innerHTML = '<div class="pet-missing">加载失败</div>'; },
    });
  }

  function interact() {
    if (!player || !player.animationState) return;
    try {
      const anims = player.skeleton.data.animations.map((a) => a.name);
      const act = ACT.find((n) => anims.includes(n) && n !== idleAnim);
      if (!act) return;
      player.animationState.setAnimation(0, act, false);
      player.animationState.addAnimation(0, idleAnim, true, 0);
    } catch {}
  }

  // ---- drag / interact ----
  host.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const r = host.getBoundingClientRect();
    drag.on = true; drag.moved = false; drag.sx = e.clientX; drag.sy = e.clientY; drag.ox = r.left; drag.oy = r.top;
    host.setPointerCapture(e.pointerId);
  });
  host.addEventListener("pointermove", (e) => {
    if (!drag.on) return;
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) drag.moved = true;
    if (drag.moved) {
      host.style.left = Math.max(0, Math.min(innerWidth - host.offsetWidth, drag.ox + dx)) + "px";
      host.style.top = Math.max(0, Math.min(innerHeight - host.offsetHeight, drag.oy + dy)) + "px";
      host.style.right = "auto"; host.style.bottom = "auto";
    }
  });
  host.addEventListener("pointerup", () => { if (drag.on && !drag.moved) interact(); drag.on = false; });
  host.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    openPicker();
  });

  launcher.addEventListener("click", openPicker);
  picker.querySelector(".pet-close").addEventListener("click", closePicker);
  picker.querySelector(".pet-backdrop").addEventListener("click", closePicker);
  searchEl.addEventListener("input", () => renderList(searchEl.value));

  // restore last pet
  try {
    const raw = localStorage.getItem(CUR_KEY);
    if (raw) loadModel(JSON.parse(raw));
  } catch {}
})();
