"use strict";

const keys = ["todoistToken", "ghUser", "ghToken", "vpsUrl"];

chrome.storage.local.get(keys, (cfg) => {
  for (const k of keys) if (cfg[k]) document.getElementById(k).value = cfg[k];
});

document.getElementById("save").addEventListener("click", () => {
  const data = {};
  for (const k of keys) data[k] = document.getElementById(k).value.trim();
  chrome.storage.local.set(data, () => {
    const s = document.getElementById("saved");
    s.textContent = "已保存 ✓";
    setTimeout(() => (s.textContent = ""), 1500);
  });
});
