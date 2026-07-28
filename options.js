"use strict";

const keys = ["todoistToken", "ghUser", "ghToken", "vpsUrl", "city"];

chrome.storage.local.get(keys, (cfg) => {
  for (const k of keys) if (cfg[k]) document.getElementById(k).value = cfg[k];
});

function saveSettings(returnToNewtab) {
  const data = {};
  for (const k of keys) data[k] = document.getElementById(k).value.trim();
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
