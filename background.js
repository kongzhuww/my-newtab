// LogicWeaver 新标签页 - 后台服务
// 点击扩展图标：把当前标签页一键收藏到「常用网站」

const GROUP_COMMON = "常用网站";

chrome.action.onClicked.addListener(async (tab) => {
  try {
    const url = normalize(tab?.url || "");
    if (!/^https?:\/\//i.test(url)) {
      // 不是网页（chrome:// 等）→ 红色提示
      await flashBadge("✕", "#f87171");
      return;
    }

    const stored = await chrome.storage.local.get([
      "quickLinks",
      "quickLinkGroupSizes",
      "quickLinksReady",
    ]);
    const links = Array.isArray(stored.quickLinks) ? stored.quickLinks : [];

    const existing = links.find((link) => {
      try { return normalize(link.url) === url; } catch { return false; }
    });

    if (existing) {
      // 已存在 → 确保它归入「常用网站」
      existing.group = GROUP_COMMON;
      if (!existing.title && tab?.title) existing.title = tab.title;
    } else {
      links.push({
        id: crypto.randomUUID(),
        title: tab?.title || hostOf(url),
        url,
        group: GROUP_COMMON,
      });
    }

    await chrome.storage.local.set({
      quickLinks: links,
      quickLinkGroupSizes: stored.quickLinkGroupSizes || {},
      quickLinksReady: true,
    });

    await flashBadge("✓", "#34d399");
  } catch {
    await flashBadge("!", "#f87171");
  }
});

function normalize(value) {
  try { return new URL(value).href; } catch { return value; }
}

function hostOf(value) {
  try { return new URL(value).hostname.replace(/^www\./, ""); } catch { return value; }
}

function flashBadge(text, color) {
  return new Promise((resolve) => {
    chrome.action.setBadgeText({ text });
    chrome.action.setBadgeBackgroundColor({ color });
    chrome.alarms.create("clear-badge", { delayInMinutes: 0.03 });
    resolve();
  });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "clear-badge") {
    chrome.action.setBadgeText({ text: "" });
  }
});

// ============================================================
// DeepSeek 对话：把新标签页里的聊天接到本机 DeepSeek Harness（dsh web）
// 说明：
//   - harness 跑在 http://127.0.0.1:3080（dsh web）
//   - 对外暴露 RPC：POST /api/session.create | session.prompt | session.history | session.models | session.selectModel
//   - 服务端有个 "Host fence"：只接受 Origin === http://127.0.0.1:3080（或无 Origin）的请求；
//     浏览器 fetch 会自动带 chrome-extension:// 的 Origin，会被 403 拒绝。
//     所以用 declarativeNetRequest 把发往 harness 的请求 Origin 改写成 http://127.0.0.1:3080。
// ============================================================

const HARNESS_BASE = "http://127.0.0.1:3080";
const DNR_RULE_ID = 1001;

async function ensureHarnessDnrRule() {
  try {
    const u = new URL(HARNESS_BASE);
    const origin = u.origin; // http://127.0.0.1:3080
    const host = u.host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // 转义用于 regex
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [DNR_RULE_ID],
      addRules: [
        {
          id: DNR_RULE_ID,
          priority: 1,
          action: {
            type: "modifyHeaders",
            requestHeaders: [{ header: "origin", operation: "set", value: origin }],
          },
          condition: {
            regexFilter: `^(https?|wss?)://${host}/`,
            resourceTypes: ["xmlhttprequest", "other", "websocket"],
          },
        },
      ],
    });
  } catch (err) {
    console.warn("ai-chat: declarativeNetRequest rule failed", err);
  }
}
const dnrReady = ensureHarnessDnrRule();

// harness RPC：POST /api/<method>，payload 为直接参数（非 {args} 包装）
async function harnessRpc(method, payload, timeoutMs = 15000) {
  await dnrReady; // 确保 Origin 改写规则已注册，避免扩展刚重载时首请求被 fence 403
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs); // 默认 15s，防止单个请求挂起拖住轮询
  let res;
  try {
    res = await fetch(`${HARNESS_BASE}/api/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: "client-request",
        rpcId: crypto.randomUUID(),
        method,
        payload,
      }),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    if (res.status === 403) {
      throw new Error("harness 拒绝请求（403）——Origin 头未通过 Host fence，通常意味着 declarativeNetRequest 改写规则未生效，请在 edge://extensions 重新加载扩展后重试");
    }
    throw new Error(`harness HTTP ${res.status}`);
  }
  const full = await res.json();
  const result = full && full.result;
  if (result && result.ok === false) {
    throw new Error((result.error && result.error.message) || "harness rpc error");
  }
  return result ? result.value : undefined;
}

// 应答 client-response（用于回答 / 取消 ask_user_question 或审批）
async function harnessRespond(message) {
  await dnrReady;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  let res;
  try {
    res = await fetch(`${HARNESS_BASE}/api/respond`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(message),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`respond HTTP ${res.status}`);
  const receipt = await res.json();
  if (receipt && receipt.accepted === false) {
    throw new Error(`应答被拒绝：${receipt.reason}`);
  }
  return receipt;
}

const AI_CHAT_SESSION_KEY = "aiChatSessionId";

// 持久会话：整个聊天共用一个 harness session（支持多轮、切换模型）
async function ensureChatSession() {
  const stored = await chrome.storage.local.get(AI_CHAT_SESSION_KEY);
  if (stored && stored[AI_CHAT_SESSION_KEY]) return stored[AI_CHAT_SESSION_KEY];
  return await resetChatSession();
}

async function resetChatSession() {
  const created = await harnessRpc("session.create", {});
  const sessionId = created && created.sessionId;
  if (!sessionId) throw new Error("harness 未返回 sessionId");
  await chrome.storage.local.set({ [AI_CHAT_SESSION_KEY]: sessionId });
  return sessionId;
}

// 一次性请求/响应操作（由页面短促调用，SW 每次被唤醒做一件事即返回）
async function handleChatOp(op, payload) {
  if (op === "sync") {
    const sessionId = await ensureChatSession();
    const sinceSeq = Number(payload && payload.sinceSeq) || -1;
    const [hist, models] = await Promise.all([
      harnessRpc("session.history", { sessionId }, 60000), // 大会话 history 可达 8MB+，放宽超时
      harnessRpc("session.models", { sessionId }),
    ]);
    const all = ((hist && hist.events) || []).filter((e) => e.event && e.event.seq > sinceSeq);
    // 只保留渲染所需的结构化事件，跳过海量 assistant/chunk 流式块（大会话几十万条会卡死页面）
    const KEEP = new Set(["user/message", "assistant/message", "step/end", "turn/end"]);
    const events = all.filter((e) => KEEP.has(e.event.type));
    let maxSeq = sinceSeq;
    for (const e of all) if (e.event.seq > maxSeq) maxSeq = e.event.seq;
    return {
      ok: true,
      sessionId,
      events,
      maxSeq,
      hasMore: !!(hist && hist.hasMore),
      models,
      current: models.current,
    };
  }
  if (op === "models") {
    const sessionId = await ensureChatSession();
    const models = await harnessRpc("session.models", { sessionId });
    return { ok: true, sessionId, models, current: models.current };
  }
  if (op === "selectModel") {
    const sessionId = await ensureChatSession();
    await harnessRpc("session.selectModel", {
      sessionId,
      provider: payload.provider,
      model: payload.model,
      reasoningEffort: payload.reasoningEffort || undefined,
    });
    const models = await harnessRpc("session.models", { sessionId });
    return { ok: true, models, current: models.current };
  }
  if (op === "newSession") {
    const sessionId = await resetChatSession();
    const models = await harnessRpc("session.models", { sessionId });
    return { ok: true, sessionId, models, current: models.current };
  }
  if (op === "send") {
    const sessionId = await ensureChatSession();
    const text = String((payload && payload.text) || "").trim();
    if (!text) return { ok: false, error: "文本为空" };
    await harnessRpc("session.prompt", {
      sessionId,
      mode: "queue",
      content: [{ type: "text", text }],
    });
    return { ok: true };
  }
  if (op === "poll") {
    const sessionId = await ensureChatSession();
    const sinceSeq = Number(payload && payload.sinceSeq) || -1;
    const hist = await harnessRpc("session.history", { sessionId }, 60000);
    const events = ((hist && hist.events) || []).filter((e) => e.event && e.event.seq > sinceSeq);
    let done = false;
    for (const e of events) if (e.event.type === "turn/end") done = true;
    return { ok: true, events, done };
  }
  if (op === "sessions") {
    const [slist, wlist, stored] = await Promise.all([
      harnessRpc("session.list", {}),
      harnessRpc("workspace.list", {}),
      chrome.storage.local.get(AI_CHAT_SESSION_KEY),
    ]);
    return {
      ok: true,
      sessions: (slist && slist.items) || [],
      workspaces: (wlist && wlist.items) || [],
      currentSessionId: stored[AI_CHAT_SESSION_KEY] || "",
    };
  }
  if (op === "switchSession") {
    const sid = String((payload && payload.sessionId) || "");
    if (!sid) return { ok: false, error: "缺少 sessionId" };
    await chrome.storage.local.set({ [AI_CHAT_SESSION_KEY]: sid });
    return { ok: true, sessionId: sid };
  }
  if (op === "answerQuestion") {
    if (!payload.rpcId) return { ok: false, error: "缺少 rpcId" };
    await harnessRespond({
      type: "client-response",
      rpcId: payload.rpcId,
      result: {
        ok: true,
        value: { sessionId: payload.sessionId, answer: payload.answer },
      },
    });
    return { ok: true };
  }
  if (op === "skipQuestion") {
    if (!payload.rpcId) return { ok: false, error: "缺少 rpcId" };
    await harnessRespond({
      type: "client-response",
      rpcId: payload.rpcId,
      result: {
        ok: false,
        error: { code: "cancelled", message: "the user skipped this question", details: {} },
      },
    });
    return { ok: true };
  }
  return { ok: false, error: `未知操作：${op}` };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message && message.type === "aiChat" && message.op) {
    handleChatOp(message.op, message)
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ ok: false, error: (err && err.message) || String(err) }));
    return true; // 异步 sendResponse
  }
});


