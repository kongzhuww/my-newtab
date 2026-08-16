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
// AI 视频分析：把文本交给本机 DeepSeek Harness（dsh web）分析
// 说明：
//   - harness 跑在 http://127.0.0.1:3080（dsh web）
//   - 对外暴露 RPC：POST /api/session.create | session.prompt | session.history
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
            regexFilter: `^${u.protocol}//${host}/`,
            resourceTypes: ["xmlhttprequest", "other"],
          },
        },
      ],
    });
  } catch (err) {
    console.warn("ai-analyze: declarativeNetRequest rule failed", err);
  }
}
ensureHarnessDnrRule();

// harness RPC：POST /api/<method>，payload 为直接参数（非 {args} 包装）
async function harnessRpc(method, payload) {
  const res = await fetch(`${HARNESS_BASE}/api/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      type: "client-request",
      rpcId: crypto.randomUUID(),
      method,
      payload,
    }),
  });
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

function buildAnalysisPrompt(text) {
  return [
    "你是视频内容分析助手。下面是一段视频的字幕/文案文本。",
    "请直接分析并输出这个视频的价值，按以下结构用中文回答：",
    "1. 视频讲了什么（一句话概括主题）",
    "2. 核心观点或知识点",
    "3. 对观众的价值（能学到什么、解决什么问题、适合谁看）",
    "4. 一句话总结",
    "",
    "要求：直接输出分析结果，不要使用任何工具，不要读写文件，不要联网搜索。",
    "",
    "视频文本如下：",
    "--- 开始 ---",
    text,
    "--- 结束 ---",
  ].join("\n");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function analyzeWithHarness(text) {
  const created = await harnessRpc("session.create", {});
  const sessionId = created && created.sessionId;
  if (!sessionId) throw new Error("harness 未返回 sessionId");

  await harnessRpc("session.prompt", {
    sessionId,
    mode: "queue",
    content: [{ type: "text", text: buildAnalysisPrompt(text) }],
  });

  const deadline = Date.now() + 10 * 60 * 1000; // 最多等 10 分钟
  let finalText = "";
  while (Date.now() < deadline) {
    await sleep(1500);
    const hist = await harnessRpc("session.history", { sessionId });
    const events = (hist && hist.events) || [];
    for (const entry of events) {
      const ev = entry && entry.event;
      if (!ev) continue;
      if (ev.type === "assistant/message") {
        const blocks = ev.data && ev.data.message && ev.data.message.content;
        if (Array.isArray(blocks)) {
          finalText = blocks
            .filter((b) => b && b.type === "text")
            .map((b) => b.text || "")
            .join("\n");
        }
      } else if (ev.type === "turn/end") {
        const reason = ev.data && ev.data.reason && ev.data.reason.kind;
        if (reason === "completed") {
          return { ok: true, text: finalText || "（模型没有返回文字内容）" };
        }
        if (reason) {
          return { ok: false, error: `分析被终止（${reason}）` };
        }
      }
    }
  }
  return { ok: false, error: "分析超时（超过 10 分钟）" };
}

// 用长连接 Port 接收分析请求：打开的 Port 会保持 service worker 存活，
// 避免长分析过程中 SW 被 30s 空闲策略回收。
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "aiAnalyze") return;
  port.onMessage.addListener((message) => {
    if (!message || message.type !== "run") return;
    const text = String(message.text || "").trim();
    if (!text) {
      port.postMessage({ ok: false, error: "文本为空" });
      return;
    }
    analyzeWithHarness(text)
      .then((result) => port.postMessage(result))
      .catch((err) => port.postMessage({ ok: false, error: (err && err.message) || String(err) }));
  });
});
