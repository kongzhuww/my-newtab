"use strict";
// Arknights Spine desktop pet for the new-tab page.
// The Spine runtime is bundled locally; models are fetched from jsDelivr.
(function () {
  const CDN = "https://cdn.jsdelivr.net/gh/isHarryh/Ark-Models@main";
  const CUR_KEY = "lw-pet-current";
  const SCALE_KEY = "lw-pet-scale";
  const FACE_KEY = "lw-pet-face";
  const WALK_KEY = "lw-pet-walk";
  const IDLE = ["Relax", "Idle", "Sit", "Interact_1", "Interact"];
  const MOVE = ["Move", "Walk", "Run", "move"];
  const ACT = ["Interact", "Interact_1", "Special", "Attack", "Sleep"];
  const BASE_W = 160;
  const BASE_H = 200;
  const WALK_SPEED = 0.8;

  let models = [];
  let modelsState = "idle";
  let current = null;
  let player = null;
  let baseAnim = "Relax";
  let scale = 0.7;
  let facing = 1;
  let walking = true;
  let walkFrame = 0;
  const drag = { on: false, sx: 0, sy: 0, ox: 0, oy: 0, moved: false };

  try {
    const savedScale = Number.parseFloat(localStorage.getItem(SCALE_KEY) || "");
    if (savedScale > 0) scale = savedScale;
    if (localStorage.getItem(FACE_KEY) === "-1") facing = -1;
    if (localStorage.getItem(WALK_KEY) === "0") walking = false;
  } catch {}

  const launcher = document.createElement("button");
  launcher.id = "pet-launch";
  launcher.title = "选择明日方舟桌宠";
  launcher.textContent = "🐧";

  const host = document.createElement("div");
  host.id = "pet-host";
  host.style.display = "none";
  host.innerHTML =
    '<div class="pet-stage"></div>' +
    '<div class="pet-status"></div>' +
    '<div class="pet-name"></div>';

  const menuBackdrop = document.createElement("div");
  menuBackdrop.className = "pet-menu-backdrop";
  menuBackdrop.hidden = true;

  const menu = document.createElement("div");
  menu.className = "pet-menu";
  menu.hidden = true;
  menu.innerHTML =
    '<p class="pet-menu-name"></p>' +
    '<div class="pet-menu-row"><span>走路</span><button data-pet-walk type="button"></button></div>' +
    '<div class="pet-menu-row"><span>大小</span><div class="pet-menu-buttons">' +
    '<button data-pet-scale="0.7" type="button">小</button>' +
    '<button data-pet-scale="1" type="button">中</button>' +
    '<button data-pet-scale="1.4" type="button">大</button></div></div>' +
    '<div class="pet-menu-row"><span>朝向</span><div class="pet-menu-buttons">' +
    '<button data-pet-face="-1" type="button">←</button>' +
    '<button data-pet-face="1" type="button">→</button></div></div>' +
    '<div class="pet-menu-actions">' +
    '<button data-pet-change type="button">换干员</button>' +
    '<button data-pet-hide type="button">隐藏</button></div>';

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
  document.body.appendChild(menuBackdrop);
  document.body.appendChild(menu);
  document.body.appendChild(picker);

  const stage = host.querySelector(".pet-stage");
  const statusEl = host.querySelector(".pet-status");
  const nameEl = host.querySelector(".pet-name");
  const listEl = picker.querySelector(".pet-list");
  const searchEl = picker.querySelector(".pet-search");

  function updateTransform() {
    stage.style.transform = `scale(${scale}) scaleX(${facing})`;
  }

  function updateMenu() {
    menu.querySelector(".pet-menu-name").textContent = current?.name || "";
    const walkButton = menu.querySelector("[data-pet-walk]");
    walkButton.textContent = walking ? "开" : "关";
    walkButton.classList.toggle("active", walking);
    menu.querySelectorAll("[data-pet-scale]").forEach((button) => {
      button.classList.toggle("active", Number(button.dataset.petScale) === scale);
    });
    menu.querySelectorAll("[data-pet-face]").forEach((button) => {
      button.classList.toggle("active", Number(button.dataset.petFace) === facing);
    });
  }

  function closeMenu() {
    menu.hidden = true;
    menuBackdrop.hidden = true;
  }

  function positionMenu() {
    const rect = host.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(innerWidth - 184, rect.left + rect.width / 2 - 88)) + "px";
    menu.style.top = Math.max(8, rect.top - menu.offsetHeight - 8) + "px";
  }

  function openMenu() {
    if (!current) return;
    updateMenu();
    menuBackdrop.hidden = false;
    menu.hidden = false;
    positionMenu();
  }

  function availableAnimation(pool) {
    if (!player?.skeleton?.data?.animations) return null;
    const animations = player.skeleton.data.animations.map((animation) => animation.name);
    return pool.find((name) => animations.includes(name)) || animations[0];
  }

  function setBase(kind) {
    if (!player?.animationState) return;
    try {
      baseAnim = availableAnimation(kind === "move" ? MOVE : IDLE) || baseAnim;
      player.animationState.setAnimation(0, baseAnim, true);
    } catch {}
  }

  function stopWalking(resetAnimation = true) {
    cancelAnimationFrame(walkFrame);
    walkFrame = 0;
    if (resetAnimation) setBase("idle");
  }

  function startWalking() {
    stopWalking(false);
    if (!walking || !current) return;
    setBase("move");
    let x = Number.parseFloat(host.style.left);
    if (!Number.isFinite(x)) x = innerWidth - 220;
    let direction = facing;
    const step = () => {
      const width = Math.round(BASE_W * scale);
      const maxX = Math.max(0, innerWidth - width);
      const floorY = Math.max(0, innerHeight - Math.round(BASE_H * scale) - 8);
      x += direction * WALK_SPEED;
      if (x <= 0) {
        x = 0;
        direction = 1;
        changeFacing(1);
      } else if (x >= maxX) {
        x = maxX;
        direction = -1;
        changeFacing(-1);
      }
      host.style.left = x + "px";
      host.style.top = floorY + "px";
      host.style.right = "auto";
      host.style.bottom = "auto";
      if (!menu.hidden) positionMenu();
      walkFrame = requestAnimationFrame(step);
    };
    walkFrame = requestAnimationFrame(step);
  }

  function changeScale(value) {
    scale = value;
    updateTransform();
    try { localStorage.setItem(SCALE_KEY, String(value)); } catch {}
    updateMenu();
  }

  function changeFacing(value) {
    facing = value;
    updateTransform();
    try { localStorage.setItem(FACE_KEY, String(value)); } catch {}
    updateMenu();
  }

  function changeWalking(value) {
    walking = value;
    try { localStorage.setItem(WALK_KEY, value ? "1" : "0"); } catch {}
    if (walking) startWalking();
    else stopWalking();
    updateMenu();
  }

  async function ensureModels() {
    if (modelsState === "ready" || modelsState === "loading") return;
    modelsState = "loading";
    try {
      const response = await fetch(`${CDN}/models_data.json`);
      const json = await response.json();
      const data = json.data || {};
      models = Object.entries(data)
        .filter(([, model]) => model && model.type === "Operator" && model.style === "BuildingDefault" && model.assetList?.[".skel"] && model.assetList?.[".atlas"])
        .map(([key, model]) => ({
          key,
          name: model.name,
          skel: `${CDN}/models/${key}/${model.assetList[".skel"]}`,
          atlas: `${CDN}/models/${key}/${model.assetList[".atlas"]}`,
        }))
        .sort((a, b) => a.name.localeCompare(b.name, "zh"));
      modelsState = "ready";
    } catch {
      modelsState = "error";
    }
  }

  function renderList(query) {
    if (modelsState === "loading") {
      listEl.innerHTML = '<p class="pet-hint">加载干员列表…</p>';
      return;
    }
    if (modelsState === "error") {
      listEl.innerHTML = '<p class="pet-hint">列表加载失败，稍后再试。</p>';
      return;
    }
    const keyword = (query || "").trim().toLowerCase();
    const visible = (keyword ? models.filter((model) => model.name.toLowerCase().includes(keyword)) : models).slice(0, 80);
    if (!visible.length) {
      listEl.innerHTML = '<p class="pet-hint">没有匹配的干员。</p>';
      return;
    }
    listEl.innerHTML = "";
    visible.forEach((model) => {
      const button = document.createElement("button");
      button.className = "pet-item";
      button.textContent = model.name;
      button.addEventListener("click", () => pick(model));
      listEl.appendChild(button);
    });
  }

  async function openPicker() {
    closeMenu();
    picker.style.display = "block";
    await ensureModels();
    renderList(searchEl.value);
  }

  function closePicker() {
    picker.style.display = "none";
  }

  function pick(model) {
    closePicker();
    changeWalking(false);
    host.style.left = "";
    host.style.top = "";
    host.style.right = "16px";
    host.style.bottom = "76px";
    try { localStorage.setItem(CUR_KEY, JSON.stringify(model)); } catch {}
    loadModel(model);
  }

  function loadModel(model) {
    current = model;
    launcher.style.display = "none";
    host.style.display = "block";
    nameEl.textContent = `${model.name} · 右键设置`;
    updateTransform();
    stopWalking(false);
    statusEl.textContent = "加载中…";
    if (!window.spine?.SpinePlayer) {
      stage.innerHTML = "";
      statusEl.textContent = "缺少 Spine 运行时";
      return;
    }
    try { player?.dispose?.(); } catch {}
    stage.innerHTML = "";
    player = new window.spine.SpinePlayer(stage, {
      skelUrl: model.skel,
      atlasUrl: model.atlas,
      premultipliedAlpha: true,
      alpha: true,
      backgroundColor: "#00000000",
      showControls: false,
      showLoading: false,
      success: (loadedPlayer) => {
        player = loadedPlayer;
        try {
          baseAnim = availableAnimation(IDLE) || baseAnim;
          player.animationState.setAnimation(0, baseAnim, true);
          statusEl.textContent = "";
          if (walking) startWalking();
        } catch {
          statusEl.textContent = "加载失败";
        }
      },
      error: () => { statusEl.textContent = "加载失败"; },
    });
  }

  function dismiss() {
    closeMenu();
    stopWalking(false);
    walking = false;
    try { localStorage.setItem(WALK_KEY, "0"); } catch {}
    try { localStorage.removeItem(CUR_KEY); } catch {}
    try { player?.dispose?.(); } catch {}
    player = null;
    current = null;
    stage.innerHTML = "";
    host.style.display = "none";
    launcher.style.display = "grid";
  }

  function interact() {
    if (!player?.animationState) return;
    try {
      const animation = ACT.find((name) => name !== baseAnim && player.skeleton.data.animations.some((item) => item.name === name));
      if (!animation) return;
      player.animationState.setAnimation(0, animation, false);
      player.animationState.addAnimation(0, baseAnim, true, 0);
    } catch {}
  }

  host.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    closeMenu();
    const rect = host.getBoundingClientRect();
    drag.on = true;
    drag.moved = false;
    drag.sx = event.clientX;
    drag.sy = event.clientY;
    drag.ox = rect.left;
    drag.oy = rect.top;
    host.setPointerCapture(event.pointerId);
  });
  host.addEventListener("pointermove", (event) => {
    if (!drag.on) return;
    const dx = event.clientX - drag.sx;
    const dy = event.clientY - drag.sy;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) drag.moved = true;
    if (!drag.moved) return;
    if (walking) changeWalking(false);
    host.style.left = Math.max(0, Math.min(innerWidth - BASE_W, drag.ox + dx)) + "px";
    host.style.top = Math.max(0, Math.min(innerHeight - BASE_H, drag.oy + dy)) + "px";
    host.style.right = "auto";
    host.style.bottom = "auto";
  });
  host.addEventListener("pointerup", () => {
    if (drag.on && !drag.moved) interact();
    drag.on = false;
  });
  host.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    if (menu.hidden) openMenu();
    else closeMenu();
  });

  launcher.addEventListener("click", openPicker);
  menuBackdrop.addEventListener("click", closeMenu);
  menuBackdrop.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    closeMenu();
  });
  menu.querySelector("[data-pet-walk]").addEventListener("click", () => changeWalking(!walking));
  menu.querySelectorAll("[data-pet-scale]").forEach((button) => {
    button.addEventListener("click", () => changeScale(Number(button.dataset.petScale)));
  });
  menu.querySelectorAll("[data-pet-face]").forEach((button) => {
    button.addEventListener("click", () => changeFacing(Number(button.dataset.petFace)));
  });
  menu.querySelector("[data-pet-change]").addEventListener("click", openPicker);
  menu.querySelector("[data-pet-hide]").addEventListener("click", dismiss);
  picker.querySelector(".pet-close").addEventListener("click", closePicker);
  picker.querySelector(".pet-backdrop").addEventListener("click", closePicker);
  searchEl.addEventListener("input", () => renderList(searchEl.value));
  window.addEventListener("resize", closeMenu);

  updateTransform();
  try {
    const saved = localStorage.getItem(CUR_KEY);
    if (saved) loadModel(JSON.parse(saved));
  } catch {}
})();
