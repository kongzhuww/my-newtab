# LogicWeaver 新标签页 · AI 调试手册

> 给后续调试这个项目的 AI / 开发者看。先读这一份，能省掉大量猜测时间。
> 最后更新：版本 1.4.6（含性能优化，尚未提交）。

---

## 1. 项目速览

| 项 | 值 |
|----|----|
| 项目位置 | `D:\default save place\GitHub\my-newtab` |
| 类型 | Chrome / Edge 扩展，Manifest V3（MV3） |
| 用途 | 替换浏览器新标签页：时钟、快捷入口、B站收藏夹管理、AI 热榜、GitHub、Todoist、VPS 探针、流量卡、桌面宠物等 |
| 技术栈 | **纯 vanilla JS / CSS / HTML，无构建步骤、无 npm 依赖** |
| 上游 | fork of LeafTab |
| 远程仓库 | `https://github.com/kongzhuww/my-newtab.git`（分支 `main`） |
| 用户环境 | Windows + Edge，profile `Default`，通过 `edge://extensions` 开发者模式加载未打包目录 |

**关键结论：没有打包/构建。改完 `newtab.js` 等文件后，只需在 `edge://extensions` 点「重新加载」，再开新标签页即可生效。**

---

## 2. 文件结构

```
my-newtab/
├── manifest.json          扩展清单（版本、权限、CSP、host_permissions）
├── newtab.html            页面结构（所有卡片/面板的 DOM 骨架）
├── newtab.css             全部样式（含树分组、拖拽、各卡片样式）
├── newtab.js              ★ 主逻辑（约 2700 行，大部分功能都在这）
├── theme-init.js          主题初始化（防闪烁）
├── pet.js                 桌面宠物（明日方舟 Spine 动画）
├── music.js               音乐面板
├── wallpaper-sandbox.js   Web Wallpaper 沙箱（iframe 内渲染）
├── options.html / options.js   设置页
└── vendor/
    ├── spine-player.js    Spine 动画运行时（本地捆绑）
    └── spine-player.css
```

> VPS 探针的服务端脚本在别处：`D:\code\vps-stats-probe.py`（部署在 VPS，systemd 服务，端口 8080，通过 Cloudflare Worker 代理到 `https://logicweaver.me/vps/stats`）。**不在此仓库内。**

---

## 3. 数据模型（chrome.storage.local 的 key）

主逻辑都存 `chrome.storage.local`。读/写辅助函数在 `newtab.js` 顶部：
- `storageGet(keys)` / `storageSet(data)` / `storageRemove(keys)`

**核心 key：**

| key | 含义 | 结构 |
|-----|------|------|
| `foTree` | ★ 树形分组（分组 tab 的数据源） | 见下 |
| `foGroups` | 旧版扁平分组（迁移源，只读，不再写） | `{ 组名: [收藏夹id...] }` |
| `foAliases` | 文件夹别名（整理用） | `{ 标题: [别名...] }` |
| `foAuto` | 整理模式：自动(full access) / 手动批准 | `boolean` |
| `foBayes` | 朴素贝叶斯分类器学习结果 | `{ classId: {feat: logProb} }` |
| `heroBackground` | 背景媒体（图片/视频/Web Wallpaper） | `{type:"db"/"web"/string, mediaType, storageKey, name}` |
| `heroBackgroundHistory` | 背景历史（上限 8 条） | 数组 |
| `trafficQuota` | 流量卡套餐额度（GB） | 数字，默认 180 |
| `todoistToken` / `ghUser` / `ghToken` / `vpsUrl` / `city` | 各卡片配置 | |
| `showWeather` / `showSites` / `showBili` / `showTodo` / `showBookmarkPanel` | 首页模块显隐 | `boolean` |

**`foTree` 结构（树形分组核心）：**

```json
{
  "id": "root",
  "children": [
    {
      "id": "fmsvn4a73or8b",          // 自定义文件夹：随机字符串 id
      "type": "folder",
      "name": "单片机项目",
      "open": true,                   // 折叠状态（可选，缺省视为展开）
      "children": [
        {
          "id": "3839033229",         // ★ 收藏夹节点：id 是【字符串】数字（B站 media_id）
          "type": "fav",
          "name": "单片机-模块",
          "children": []
        }
      ]
    }
  ]
}
```

> ⚠️ **最容易踩的坑**：树节点里收藏夹的 `id` 是**字符串**（`String(fid)`），而 B站 API 返回的收藏夹 `id` 是**数字**。任何把两者直接 `===` 比较的地方都会匹配失败。解决：统一 `Number()` 或统一 `String()`（见 §6 坑 1）。

---

## 4. 核心函数地图（newtab.js）

### 4.1 通用
- `$ = document.getElementById`；`el(tag, cls, html)` 建元素；`esc()` HTML 转义。
- `biliJson(url)`：`fetch` + `credentials:"include"`（带 B站 cookie）。
- `fetchTimeout(url, opts, ms)`：带超时的 fetch（AbortController，默认 8s）。★ 性能优化时新增。

### 4.2 B站收藏夹卡片（三个 tab：整理 / 字幕 / 分组）
HTML 里对应：`pane-organizer`(`#fo-body`) / `pane-subtitle`(`#wb-bili`) / `pane-groups`(`.sf-layout`)。

| 函数 | 作用 |
|------|------|
| `getFlatGroups()` | ★ 把 `foTree` 扁平化成 `{ 路径: [数字id...] }`（含"未分组"）。**整理和字幕两个 tab 都从这里取分组，不要再读 foGroups** |
| `loadBiliWorkbench()` | 字幕 tab：按分组展示收藏夹，点击展开加载视频封面 |
| `loadFolderOrganizer()` | 整理 tab：分页(10/页) + 逐视频取标签 + 匹配/贝叶斯建议 + 移动/删除 |
| `renderFolderOrganizer()` | 整理 tab 渲染 |
| `groupedFolderOptions()` | 生成"按分组分组的收藏夹下拉框" |
| `loadSubfolderManager()` | 分组 tab：加载 foTree → `renderTree()`，首次从 foGroups 迁移 |
| `renderTree()` | 渲染左侧文件夹树 + 右侧视频网格 |
| `openFavFolder(fid)` | 点击收藏夹节点 → 右侧网格加载视频 |
| `initTreeDrag()` | ★ 拖拽（全局 mousedown/mousemove/mouseup，见坑 3） |
| `saveTree()` | `chrome.storage.local.set({foTree})` 并重载 |

树操作辅助：`newFolderNode(name)`、`findNode(tree,id)`、`findParent(tree,id)`、`removeNodeById(tree,id)`、`isDescendant(a,b)`。

### 4.3 B站 API 操作
- `moveBiliVideo(srcId, tarId, aid, mid)`：POST `x/v3/fav/resource/move`（需 `mid` + `csrf` + UA/Referer/Origin）。
- `deleteBiliVideo(fid, aid)`：POST `x/v3/fav/resource/deal`。
- `getBiliJct()`：通过 `chrome.cookies.get` 取 `bili_jct`。
- `fetchBiliSubtitle(bvid)`：抓 AI 字幕（走 wbi 签名）。

### 4.4 wbi 签名（B站接口风控）
- `md5(str)`：纯 JS MD5（已验证与 Node crypto 一致）。
- `getWbiKeys()` / `encWbi(params, ik, sk)`：mixin key 表 `WBI_MIXIN_TAB`，`w_rid = md5(排序后 query + mixinKey)`。

### 4.5 朴素贝叶斯分类器
- `bayesFeatures(media, tags)`：特征 = `t:标签` / `z:分区` / `u:UP主`。
- `bayesTrain(folderId, features)`：移动成功后学习。
- `bayesPredict(features)`：log 概率 + Laplace 平滑 + softmax 置信度。
- `bayesStats()` / `showBayesDetail()`：学习统计。

### 4.6 其他卡片
- `loadAiHot()` / `loadTrending()` / `loadGitHub()` / `loadVps()` / `loadTraffic()` / `loadTodos()` / `loadWeather()` / `loadBili()`。
- `tick()`：时钟，`setInterval(tick, 1000)`。
- `boot()`：★ 入口，见坑 5 的顺序问题。

### 4.7 桌面宠物（pet.js，独立 IIFE）
- Spine 动画 + 走路，`FRAME_INTERVAL` 现在为 `1000/24`（24 FPS）。
- `limitPlayerFrameRate()` 覆盖 `drawFrame` 做节流；`stopPlayer()` 卸载；`stopRendering()` 停渲染。
- **性能优化**：`visibilitychange` 时页面不可见则停渲染 + 停走路，可见再恢复。

---

## 5. B站 API 速查

| 接口 | 用途 | 关键返回 |
|------|------|----------|
| `GET x/web-interface/nav` | 登录态 + `mid` | `data.isLogin`, `data.mid` |
| `GET x/v3/fav/folder/created/list-all?up_mid={mid}` | 收藏夹列表（**需登录**） | `data.list[]`：`id`(数字), `title`, `media_count`, `cover` |
| `GET x/v3/fav/resource/list?media_id&pn&ps&platform=web` | 收藏夹内视频 | `data.medias[]`：`id`/`aid`, `bvid`, `title`, `cover`, `upper.name`, `cnt_info.play` |
| `POST x/v3/fav/resource/move` | 移动视频 | body: `src_media_id, tar_media_id, mid, resources="aid:2", platform=web, csrf` |
| `POST x/v3/fav/resource/deal` | 取消收藏 | body: `csrf, rid=aid, type=2, del_media_ids` |
| `GET x/tag/archive/tags?bvid=` | 视频标签 | `data[]`：`tag_name` |
| `GET x/player/wbi/v2?{wbi签名}` | 字幕列表 | `data.subtitle.subtitles[]` |

- 请求头：`User-Agent`(BILI_UA)、`Referer: https://www.bilibili.com/`、`Origin: https://www.bilibili.com`（move/deal 必需，否则可能 `request was banned`）。
- 登录态靠浏览器 cookie（`credentials:"include"`），`bili_jct` 用 `chrome.cookies.get` 拿。

---

## 6. 已知坑与修复史（★ 最重要，改前必看）

1. **收藏夹 id 字符串 vs 数字**：树节点存字符串 id，B站 API 返回数字 id。`getFlatGroups()` 现在统一 `Number()` 后输出。任何新代码做 id 比较时，务必 `String()` 双转或 `Number()` 统一，否则分组内容会"消失"/重复进"未分组"。症状：整理/字幕里分组内容不显示。
2. **拖拽用 mousedown，不是 HTML5 DnD，也不是 pointer events**：后两者在扩展里都静默失败（"还是不能拖动"）。现用全局 `mousedown/mousemove/mouseup` + 跟随鼠标 ghost + 插入线（`insert-before/after/into`）。
3. **`initTreeDrag()` 只能全局绑定一次**：曾把它写在 `renderTree()` 里导致每次渲染重复绑监听 → 拖拽卡死 + 大量 ghost 泄漏。现在是 boot 里一次性绑定。
4. **文件夹展开状态**：存在 `node.open` 字段并持久化，`renderTree` 时据此恢复，不能每次渲染都重置。
5. **boot() 调用顺序陷阱**：
   ```js
   loadFolderOrganizer();   // 先跑
   loadBiliWorkbench();     // 再跑
   loadSubfolderManager();  // 最后才填充 favTree 全局变量
   ```
   所以整理/字幕**不能依赖内存里的 `favTree` 全局**，必须各自通过 `getFlatGroups()` 独立读 storage。这是历史 bug 根源。
6. **`renderTree()` 会把"未分组"收藏夹临时 push 到 `favTree.children`**（不 saveTree）。一旦之后有任何 `saveTree()`（拖拽/建文件夹/折叠），这些未分组节点会被固化进 foTree 根目录——这是预期行为，别当成 bug。
7. **`loadFileManager()`（`fm-*` 系列）是死代码**：HTML 里没有 `#fm-sidebar`，函数开头 `if(!sidebar) return` 直接返回，未被 boot 调用。可忽略。
8. **B站 list-all 接口未登录时 `data` 为 null**：不要在未登录环境里 curl 它判断 id 类型，会误判。

---

## 7. 调试实操

### 7.1 重新加载扩展
1. 打开 `edge://extensions`。
2. 找到「LogicWeaver 新标签页」，点「重新加载」。
3. 开新标签页测试；若加了新权限需重新授权。

### 7.2 看报错
- 新标签页里按 `F12` 打开 DevTools → Console。
- `loadXxx` 系列的 `catch` 大多会把错误写进页面文字或只显示"加载失败"。排查时可在对应 `catch` 里临时把 `e.message` 打到 `body.innerHTML`。

### 7.3 直接读 chrome.storage（不用开浏览器 DevTools）
扩展在 Edge 里的存储是 LevelDB，**WAL 文件（`.log`）是明文**，可直接读：

- 扩展 id：`dmkpoffcbkoggmaopgpjhjdmlphhceed`（本机 Default profile 的未打包 id；其它机器会不同）。
- 数据路径：
  `C:\Users\33583\AppData\Local\Microsoft\Edge\User Data\Default\Local Extension Settings\dmkpoffcbkoggmaopgpjhjdmlphhceed\`
- 文件通常是 `000003.log`（WAL）。**被 Edge 占用**，要用共享读打开：

```powershell
$f = "C:\Users\33583\AppData\Local\Microsoft\Edge\User Data\Default\Local Extension Settings\dmkpoffcbkoggmaopgpjhjdmlphhceed\000003.log"
$fs = [System.IO.File]::Open($f, 'Open', 'Read', 'ReadWrite')
$ms = New-Object System.IO.MemoryStream; $fs.CopyTo($ms); $fs.Close()
$s = [System.Text.Encoding]::UTF8.GetString($ms.ToArray())
$s.IndexOf('foTree')   # 然后 Substring 看上下文，能看到 foTree/foGroups 的 JSON 值
```

> 注意：`.ldb` 是 Snappy 压缩的（搜不到明文），但 `.log`(WAL) 是明文，直接搜 key 名即可。
> 扩展 id 若变了，从 `Preferences` 里找：搜 `chrome_url_overrides`，看 `newtab` 的 `chrome-extension://<id>/newtab.html`。

### 7.4 计算未打包扩展 id（跨机器）
对扩展目录绝对路径（小写、正斜杠）做 SHA256，取前 32 个 hex 字符，每字符按 `0-9a-f → a-p` 映射。

### 7.5 语法校验
```powershell
node --check "D:\default save place\GitHub\my-newtab\newtab.js"
```

---

## 8. 性能注意事项（2026 新增优化）

- **桌面宠物 Spine 动画**是最吃资源的常驻渲染（30→24 FPS + 后台暂停）。
- **背景视频/Web Wallpaper**：4K 视频循环播放极吃 GPU。`visibilitychange` 时自动暂停。
- **VPS 探针每 15s 轮询**：已加 8s 超时 + 页面不可见时不请求，避免挂起请求堆积。
- **流量卡请求**：已加 6s 超时。
- 时钟 `setInterval(tick, 1000)` 很轻量，无需动。
- 新增轮询/动画时，务必考虑：① 加超时；② `document.hidden` 时跳过；③ 避免在 `renderTree` 等高频函数里重复绑监听。

---

## 9. 安全红线（严禁写进代码或提交）

- B站登录依赖浏览器 cookie（`credentials:"include"`），**不要**硬编码 `SESSDATA` / `bili_jct`。
- VPS 的 SSH 密钥、DSH 凭据等**绝不进仓库**；`git add` 前自查 diff 里有没有 `SESSDATA|bili_jct|BEGIN.*PRIVATE|password=`。
- 提交前跑：`git diff | Select-String -Pattern 'SESSDATA|bili_jct|DedeUserID|PRIVATE KEY|password\s*=' -CaseSensitive:$false`。

---

## 10. 提交 / 发布流程

```powershell
cd "D:\default save place\GitHub\my-newtab"
node --check newtab.js
# 改 manifest.json 版本号
git add -A
git commit -m "描述"
git push origin main
```

改完记得在 `edge://extensions` 重新加载，再让用户刷新测试。

---

## 11. 常见症状 → 原因速查

| 症状 | 最可能原因 |
|------|-----------|
| 整理/字幕里分组内容不显示 | id 字符串/数字不匹配（§6 坑 1） |
| 分组 tab 里收藏夹消失/重复 | 读了 foGroups 而不是 foTree；或 renderTree 临时 push 未分组节点 |
| 拖不动节点 | 用了 HTML5 DnD / pointer events（§6 坑 2） |
| 拖拽卡死、一堆 ghost | initTreeDrag 被重复绑定（§6 坑 3） |
| 折叠状态每次重置 | 没持久化 `node.open`（§6 坑 4） |
| move/deal 接口 banned | 缺 `mid` 或 UA/Referer/Origin 头 |
| 整个页面/电脑卡 | 优先查 4K 视频背景、桌宠 Spine、VPS 轮询堆积（§8） |

---

## 12. AI 视频分析（接入本机 DeepSeek Harness）

> 「B站收藏夹」和「AI HOT」之间的独立卡片。粘贴视频字幕/文案 txt → 点「✨ 分析价值」→ 交给本机 harness 的 deepseek-v4-pro 分析「这个视频有什么价值」。

**数据流**：`newtab.js` 点按钮 → 长连接 Port `aiAnalyze` 发消息 → `background.js` 调 harness HTTP API → 返回分析文本 → 渲染到 `#ai-analyze-output`。用 Port 而非 `sendMessage`，是为了保持 service worker 存活（避免长分析被 30s 空闲策略回收）。

**harness HTTP API（关键：dot 分隔，不是斜杠）**：
- `POST http://127.0.0.1:3080/api/session.create`，payload `{}`（可选 `cwd`）→ 返回 `{sessionId, agentPreset}`。
- `POST /api/session.prompt`，payload `{sessionId, mode:"queue", content:[{type:"text", text}]}`。
- `POST /api/session.history`，payload `{sessionId}` → 返回 `{events:[{event:{type,seq,data}}], hasMore}`。
- 请求 body：`{"type":"client-request","rpcId":"<uuid>","method":"session.prompt","payload":{...}}`；响应 `{"type":"server-response","rpcId","result":{ok,value|error}}`。
- 最终文本在 `assistant/message` 事件的 `data.message.content[].text`（取 `type==="text"` 的块拼接）；完成标志是 `turn/end` 事件的 `data.reason.kind === "completed"`。

**Host fence（最关键的坑）**：harness 只接受 `Origin` 头为 `http://127.0.0.1:3080`（或无 Origin）的请求，其它 Origin（含 `chrome-extension://`、`http://localhost:3080`）一律 403。浏览器 fetch 会自动带 `chrome-extension://<id>`，所以：
1. `background.js` 用 **declarativeNetRequest 动态规则**（id 1001）把发往 harness 的请求 `Origin` 改写成 `http://127.0.0.1:3080`；
2. `manifest.json` 的 `host_permissions` 加了 `http://127.0.0.1:3080/*` 和 `http://localhost:3080/*`，配合 SW fetch 绕过 CORS（harness 不返回任何 CORS 头）。

**调试**：卡片报「403」→ DNR 规则没生效，到 `edge://extensions` 点「重新加载」（新增 `declarativeNetRequest` 权限必须重载）再开新标签页。卡片报「连接失败/中断」→ 确认 harness 在跑（`dsh web`，端口 3080）。
