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
