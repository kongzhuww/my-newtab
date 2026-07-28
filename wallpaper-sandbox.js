let activeUrls = [];

function trackUrl(url) {
  activeUrls.push(url);
  return url;
}

function clearUrls() {
  activeUrls.forEach((url) => URL.revokeObjectURL(url));
  activeUrls = [];
}

function normalizePath(path) {
  return String(path || "").replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "");
}

function resolvePath(fromPath, target) {
  const raw = String(target || "").trim().replace(/^['"]|['"]$/g, "");
  if (!raw || /^(?:[a-z][a-z0-9+.-]*:|#|data:|blob:)/i.test(raw)) return "";
  const [pathname] = raw.split(/[?#]/);
  if (!pathname) return "";
  const base = raw.startsWith("/") ? "" : normalizePath(fromPath).split("/").slice(0, -1).join("/");
  const parts = `${base ? base + "/" : ""}${pathname.replace(/^\/+/, "")}`.split("/");
  const stack = [];
  parts.forEach((part) => {
    if (!part || part === ".") return;
    if (part === "..") stack.pop();
    else stack.push(part);
  });
  return stack.join("/").toLowerCase();
}

async function readText(file) {
  return file.text ? file.text() : new Response(file).text();
}

async function renderWallpaper(pack) {
  clearUrls();
  const root = document.getElementById("wallpaper-root");
  root.innerHTML = "";

  if (typeof pack.entry !== "string") return;
  const entries = Array.isArray(pack.files) ? pack.files : [];
  const byPath = new Map(entries.map((entry) => [normalizePath(entry.path).toLowerCase(), entry]));
  const urls = new Map();
  const getUrl = async (fromPath, target) => {
    const key = resolvePath(fromPath, target);
    const entry = byPath.get(key);
    if (!entry?.file) return target;
    if (!(entry.file instanceof Blob)) return target;
    if (!urls.has(key)) urls.set(key, trackUrl(URL.createObjectURL(new Blob([entry.file], { type: entry.mime || entry.file.type || "application/octet-stream" }))));
    return urls.get(key);
  };
  const rewriteCss = async (css, fromPath) => {
    const matches = [...String(css || "").matchAll(/url\(([^)]+)\)/gi)];
    for (const match of matches) {
      const url = await getUrl(fromPath, match[1].trim());
      css = css.replace(match[0], `url(${JSON.stringify(url)})`);
    }
    return css;
  };
  const rewriteAttr = async (doc, selector, attr, fromPath) => {
    for (const node of doc.querySelectorAll(selector)) {
      const value = node.getAttribute(attr);
      if (value) node.setAttribute(attr, await getUrl(fromPath, value));
    }
  };

  const entryPath = normalizePath(pack.entry).toLowerCase();
  const entry = byPath.get(entryPath);
  if (!entry?.file || !(entry.file instanceof Blob)) return;

  const doc = new DOMParser().parseFromString(await readText(entry.file), "text/html");
  const api = doc.createElement("script");
  api.textContent = "window.wallpaperPropertyListener=window.wallpaperPropertyListener||{};window.wallpaperRegisterAudioListener=window.wallpaperRegisterAudioListener||function(){};";
  doc.head.prepend(api);

  for (const node of doc.querySelectorAll('link[rel~="stylesheet"][href]')) {
    const href = node.getAttribute("href");
    const cssEntry = byPath.get(resolvePath(pack.entry, href));
    if (cssEntry?.file && cssEntry.file instanceof Blob) {
      const css = await rewriteCss(await readText(cssEntry.file), cssEntry.path);
      node.setAttribute("href", trackUrl(URL.createObjectURL(new Blob([css], { type: "text/css" }))));
    }
  }
  await rewriteAttr(doc, "img[src],script[src],source[src],video[src],audio[src]", "src", pack.entry);
  await rewriteAttr(doc, "link[href]", "href", pack.entry);
  for (const node of doc.querySelectorAll("[style]")) node.setAttribute("style", await rewriteCss(node.getAttribute("style"), pack.entry));
  for (const node of doc.querySelectorAll("style")) node.textContent = await rewriteCss(node.textContent, pack.entry);

  const html = "<!doctype html>\n" + doc.documentElement.outerHTML;
  const frame = document.createElement("iframe");
  frame.title = pack.name || "Web Wallpaper";
  frame.sandbox = "allow-scripts allow-pointer-lock";
  frame.src = trackUrl(URL.createObjectURL(new Blob([html], { type: "text/html" })));
  root.appendChild(frame);
}

window.addEventListener("message", (event) => {
  if (event.data?.type === "web") renderWallpaper(event.data).catch(console.error);
});
