# vendor（本地打包的第三方运行时）

浏览器插件(MV3)**禁止从 CDN 加载脚本**,所以桌宠用的 Spine 运行时必须放在本地这里。

## 需要两个文件（一次性下载）

把下面两个文件下载并放到 **本 `vendor/` 文件夹**:

1. **spine-player.js**
   https://cdn.jsdelivr.net/gh/EsotericSoftware/spine-runtimes@3.8/spine-ts/build/spine-player.js

2. **spine-player.css**
   https://cdn.jsdelivr.net/gh/EsotericSoftware/spine-runtimes@3.8/spine-ts/player/css/spine-player.css

### 命令行下载(在这个 vendor 文件夹里执行)

```powershell
curl.exe -L -o spine-player.js  "https://cdn.jsdelivr.net/gh/EsotericSoftware/spine-runtimes@3.8/spine-ts/build/spine-player.js"
curl.exe -L -o spine-player.css "https://cdn.jsdelivr.net/gh/EsotericSoftware/spine-runtimes@3.8/spine-ts/player/css/spine-player.css"
```

或者直接用浏览器打开上面两个链接,右键「另存为」到本文件夹。

下载后回 `edge://extensions` 刷新插件,新标签页右下角 🐧 就能选干员桌宠了。
（没有这两个文件时,桌宠会提示「缺少 Spine 运行时」,其它功能不受影响。）
