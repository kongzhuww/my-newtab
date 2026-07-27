"use strict";
// Runs in <head> before render so the saved theme applies with no flash.
try {
  const t = localStorage.getItem("theme");
  if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
} catch (e) {}
