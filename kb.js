"use strict";
// Local knowledge base (chrome.storage.local). Extension-local — not synced with
// the website's Supabase KB (that needs a read policy; can be added later).
(function () {
  let notes = [];
  const mk = (t, c, h) => { const e = document.createElement(t); if (c) e.className = c; if (h != null) e.innerHTML = h; return e; };
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const uid = () => { try { return crypto.randomUUID(); } catch { return Date.now() + "-" + Math.floor(Math.random() * 1e6); } };
  const save = () => chrome.storage.local.set({ kbNotes: notes });

  const launch = mk("button", "tb-pill", "📚 知识库");
  const panel = mk("div", "kb-panel");
  panel.style.display = "none";
  panel.innerHTML =
    '<header><span>📚 我的知识库</span><span class="kb-grow"></span><button class="kb-add">＋ 新增</button><button class="kb-close">✕</button></header>' +
    '<input class="kb-search" placeholder="搜索标题 / 内容 / 标签…">' +
    '<div class="kb-form" style="display:none"><input class="kb-t" placeholder="标题"><textarea class="kb-c" placeholder="内容…"></textarea><input class="kb-g" placeholder="标签,逗号分隔"><button class="kb-save">保存</button></div>' +
    '<div class="kb-list"></div>';
  (document.getElementById("tb-launchers") || document.body).append(launch);
  document.body.append(panel);

  const q = (s) => panel.querySelector(s);
  const listEl = q(".kb-list"), searchEl = q(".kb-search"), form = q(".kb-form");

  function render() {
    const kw = searchEl.value.trim().toLowerCase();
    const list = notes.filter((n) => !kw || (n.title + " " + n.content + " " + (n.tags || []).join(" ")).toLowerCase().includes(kw));
    if (!list.length) { listEl.innerHTML = '<p class="kb-hint">' + (notes.length ? "没有匹配。" : "还没有笔记,点「＋ 新增」。") + "</p>"; return; }
    listEl.innerHTML = "";
    list.forEach((n) => {
      const card = mk("div", "kb-card");
      card.innerHTML = `<div class="kb-card-h"><b>${esc(n.title) || "无标题"}</b><button class="kb-del" title="删除">✕</button></div><div class="kb-body">${esc(n.content).replace(/\n/g, "<br>")}</div>${(n.tags || []).length ? `<div class="kb-tags">${n.tags.map((t) => `<span>#${esc(t)}</span>`).join("")}</div>` : ""}`;
      card.querySelector(".kb-card-h").addEventListener("click", (e) => { if (!e.target.classList.contains("kb-del")) card.classList.toggle("open"); });
      card.querySelector(".kb-del").addEventListener("click", () => { notes = notes.filter((x) => x.id !== n.id); save(); render(); });
      listEl.appendChild(card);
    });
  }

  q(".kb-add").addEventListener("click", () => { form.style.display = form.style.display === "none" ? "block" : "none"; });
  q(".kb-save").addEventListener("click", () => {
    const title = q(".kb-t").value.trim(), content = q(".kb-c").value.trim();
    if (!title && !content) return;
    notes.unshift({ id: uid(), title, content, tags: q(".kb-g").value.split(/[,，]/).map((s) => s.trim()).filter(Boolean), ts: Date.now() });
    save(); q(".kb-t").value = q(".kb-c").value = q(".kb-g").value = ""; form.style.display = "none"; render();
  });
  q(".kb-close").addEventListener("click", () => (panel.style.display = "none"));
  searchEl.addEventListener("input", render);
  launch.addEventListener("click", () => { panel.style.display = panel.style.display === "none" ? "flex" : "none"; });

  chrome.storage.local.get(["kbNotes"], (r) => { notes = r.kbNotes || []; render(); });
})();
