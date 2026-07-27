# LogicWeaver 新标签页

一个个人**新标签页仪表盘**浏览器插件(Manifest V3,Edge / Chrome 通用):
打开新标签页就是你的面板 —— 时钟、**B站收藏夹**、**Todoist 今日待办**(可勾选完成)、**GitHub Star**。

## 为什么用插件

插件跑在你自己的浏览器里,可以**直接用你已登录的 B 站 cookie** 调接口 —— 不再有网站版的 412 风控,也不用 VPS 中转。

## 安装(开发者模式加载)

1. 下载/克隆本仓库到本地。
2. 打开 `edge://extensions`(或 `chrome://extensions`)。
3. 右上角打开「**开发者模式**」。
4. 点「**加载解压缩的扩展**」,选中本仓库文件夹。
5. 新开一个标签页,就能看到面板。

## 配置

- **B站收藏夹**:无需配置。只要浏览器里登录了 bilibili.com,新标签页会自动显示你的收藏夹(点文件夹展开、点视频跳转)。若显示未登录,先去 bilibili.com 登录再刷新。
- **Todoist / GitHub**:点面板左上角「⚙ 设置」(或插件详情 → 扩展选项),填:
  - Todoist API Token(Todoist → Settings → Integrations → Developer)。
  - GitHub 用户名(必填)+ Token(可选,私有/更高频率)。

配置保存在浏览器本地(`chrome.storage.local`),不上传任何服务器。

## 文件

| 文件 | 作用 |
|------|------|
| `manifest.json` | MV3 清单,新标签页覆盖 + host 权限 |
| `newtab.html/.css/.js` | 新标签页仪表盘 |
| `options.html/.js` | 设置页(Todoist / GitHub) |

## 后续可加

小黑盒收藏夹、VPS 探针、B站/知识库更多模块、主题切换等。
