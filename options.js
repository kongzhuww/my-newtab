"use strict";

const keys = ["todoistToken", "ghUser", "ghToken", "vpsUrl", "city", "showWeather", "showSites", "showBili", "showTodo", "showBookmarkPanel"];
const toggleKeys = ["showWeather", "showSites", "showBili", "showTodo", "showBookmarkPanel"];

chrome.storage.local.get(keys, (cfg) => {
  for (const k of keys) {
    const input = document.getElementById(k);
    if (!input) continue;
    if (toggleKeys.includes(k)) input.checked = cfg[k] !== false;
    else if (cfg[k]) input.value = cfg[k];
  }
});

function saveSettings(returnToNewtab) {
  const data = {};
  for (const k of keys) {
    const input = document.getElementById(k);
    data[k] = toggleKeys.includes(k) ? input.checked : input.value.trim();
  }
  chrome.storage.local.set(data, () => {
    const s = document.getElementById("saved");
    if (chrome.runtime.lastError) {
      s.textContent = "保存失败，请重试";
      s.classList.add("error");
      return;
    }
    s.classList.remove("error");
    s.textContent = "已保存 ✓";
    if (returnToNewtab) {
      location.href = "newtab.html";
      return;
    }
    setTimeout(() => (s.textContent = ""), 1500);
  });
}

document.getElementById("options-form").addEventListener("submit", (event) => {
  event.preventDefault();
  saveSettings(false);
});

document.getElementById("save-return").addEventListener("click", () => saveSettings(true));


toggleKeys.forEach((key) => {
  const input = document.getElementById(key);
  if (input) input.addEventListener("change", () => saveSettings(false));
});
