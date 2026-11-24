# UmeYc-Portal 交接文档

> 更新时间：2026-11-24 · 当前版本：`1.0.0-zh-cn.48`（最新提交见 `git log`）
>
> **给接手的 Claude：** 先读仓库根的 `README.md`，按它顶部的阅读顺序接手；本文件是第 2 步，也是实际进度、待办、构建/发布流程和踩坑记录的权威来源。用户使用简体中文交流。
>
> **给用户：** 在新电脑解压后用 Claude Code 打开这个文件夹，说一句「先读 README.md，再按里面的顺序接手这个项目」即可。

---

## 1. 项目是什么

- **Steam Deck Decky Loader 插件**：在游戏模式里打开网页 / 本地长图 / 离线网页 / 本地地图册，支持侧栏、手柄滚动、扫码传网址或图片。
- 本 fork：<https://github.com/ChongChongCoda/UmeYc-Portal>
- 上游 fork：<https://github.com/xiaochaom/UmeYc-Portal>（又来自 `ajustinjames/decky-portal`，稳定基线 `v0.1.1`）
- 本地主分支：`main`；远程 `origin` 指向上面的 fork，`upstream` 指向上游。
- 发布方式：GitHub Releases，标签格式 `fork-1.0.0-zh-cn.NN`；资产固定名为 `UmeYc-Portal.zip`。
- 最新 Release：<https://github.com/ChongChongCoda/UmeYc-Portal/releases/tag/fork-1.0.0-zh-cn.48>
- 直链：`https://github.com/ChongChongCoda/UmeYc-Portal/releases/latest/download/UmeYc-Portal.zip`
- 交接包内已带构建产物：`out/UmeYc-Portal.zip`（633,573 字节，与 .42 Release 资产一致）。

插件名 `UmeYc-Portal`，Decky 安装时选择「从 ZIP 文件安装插件」。

---

## 2. 当前进度（已完成并发布）

### 2.1 功能清单

1. **中文界面**：设置、网页栏、提示全部汉化。
2. **本地攻略 / 图片**：浏览 SD 卡或内置存储；打开、删除、随侧栏显示、右摇杆/触屏滚动、L1/R1/L3 缩放。
3. **网页与历史**：最近 20 条，标题单行省略；B 站切集同步实际 URL/标题；每项可删除记录。
4. **扫码传送**：Deck 本机生成二维码，同一 Wi-Fi 下手机发网址或传图；图片保存位置可选并记忆。
5. **扫码自动离线保存**：收到网址后等待加载并保存静态快照；小黑盒页面额外抓取一级文章链接（最多 30 个）到 `pages/<n>/`，主页链接改写为本地页面；抓取期间隐藏阅读器，避免中间页面进历史。
6. **离线网页集合**：只读 loopback 服务，CSP 禁止脚本/外部请求；支持整目录删除、部分保存标记。
7. **离线自动接续（.42 新增）**：断网时（`navigator.onLine === false`）从「网页」历史重新打开已保存过的网址，会自动打开对应离线集合；找不到才回退原网址。
8. **保存位置迁移**：图片和离线网页无损迁移，后台进度、取消、失败重试。
9. **本地地图册**：引用本地文件夹（如《女王魔域》2D/3D 地图册 + 物品查询），只读服务、不复制数据；注入触屏手势层（单指拖动、双指捏合缩放/平移）。
10. **地图 Steam 键盘搜索**：网页标题栏「搜索」→ 直接驱动 Steam 自带屏幕键盘（非模态 `ShowVirtualKeyboard`），中文 IME 提交可接收，不遮挡候选词；键盘打开时左侧面板收为顶部输入条；不可用时回退手机扫码输入。
11. **地图不缩放排版**：地图页隐藏网页缩放按钮，L1/R1 不发网页缩放。
12. **自动检查更新（.37–.39）**：设置页「检查并下载更新」+ 打开设置每小时最多自动查一次；从 GitHub Releases 下载并校验 ZIP，替换 `~/Downloads/UmeYc-Portal.zip`；**只下载不安装**，用户自己到 Decky 安装。
13. **全屏视频控制**：R3 发送 F 切换全屏；全屏时摇杆左右快退/快进、上下调音量。
14. **随侧栏播放/暂停**：可选，收起前暂停、展开后继续。
15. **离线保存跳转匹配（.43）**：扫码发送短链或分享链、页面跳转后网址变化时，若 CEF 中只有一个非 Steam 网页，按该页面保存，不再报「等待网页加载超时」。
16. **窗口主动清理（.43）**：卸载/重载插件时主动 `Destroy()` 阅读器 BrowserView，并在创建新视图前销毁上一插件实例残留的 `window.portal`，避免关不掉的残留网页窗口。
17. **随插件页显示（.45）**：Decky 中打开本插件页时显示阅读器；按返回键回到插件列表时自动收起。通过 `titleView` 上的 `data-umeyc-title` 标记判断当前是否在插件页（`isPortalPageOpen`）；旧版 Decky 找不到标记时回退到「侧栏打开即显示」。
18. **手机版网页（.46）**：设置页开关；开启后 `WebScroller` 对当前页设置 Android Chrome UA、触摸模拟和移动视口并刷新一次，站点切到移动版；每次重连后重新应用，关闭时恢复桌面 UA 并刷新。状态存 `portal.mobileWeb`。
19. **缩放不留白（.46）**：`assets/web-zoom.js` 在首次缩放前记录占满视口的容器，缩小时给它们设置 `min-height: calc(100vh / 缩放比例)`，抵消 CSS zoom 不改变 `vh` 的问题；恢复默认时还原。
20. **手机版下禁用缩放（.47）**：手机版页面的媒体查询会被 CSS zoom 破坏，缩放后无法用「默认」可靠恢复。手机版开启时隐藏网页标题栏的缩放按钮，L1/R1/L3 不再发送缩放，后端 `WebScroller.zoom()` 也直接拒绝；R3 视频全屏不受影响。关闭手机版后恢复缩放。
21. **更新检查不会无限卡住（.48）**：`update_checker.py` 增加 75 秒总下载期限与非阻塞任务锁（重复请求立即返回「已有更新检查正在进行」）；`main.py` 用 95 秒 `wait_for` 包住检查；设置页再加 110 秒兜底超时，并在检查进行中点击按钮时提示「正在检查更新」。

### 2.2 最近提交

```
7d26746 Open saved offline copies when the Deck is offline
e990626 Save one level of Xiaoheihe article links offline
58d61ca Keep the keyboard search strip horizontal
3f3b883 Trust the system CA store when downloading updates
fba855e Make update checks survive proxy and reporting failures
346b53f Download new releases from the settings panel
259f258 Open the same keyboard Steam text fields use
bfb00a5 Use Steam's keyboard callbacks for atlas search
9e68f44 Make atlas search explicit and stop page zoom reflow
a313341 Add smartphone-style touch gestures to the local atlas
```

### 2.3 已验证 / 未验证

- 前端：`pnpm test:coverage` **184 个测试全部通过**，覆盖率达标（statements 83%+，branches 75%+）。
- Python：滚动、抓取、MHTML、离线存储、更新检查、迁移等测试通过；Windows 上少数 Linux-only 用例（`os.geteuid`）会报错，属环境差异，不是回归。
- Deck 实机已确认：自动更新检查成功（.39）、Steam 键盘地图搜索通过（.40）、.42 可安装。
- **实机反馈（.42/.44）**：扫码后离线保存报「等待网页加载超时」、插件卸载后窗口残留，已在 .43 修复；.44 的悬浮「攻略」按钮被否决，.45 改为随插件页显示/返回即收起。
- **.45 实机确认（2026-11-24）**：点开插件页显示、返回插件列表自动收起，用户确认可用。
- **尚未实机确认**：.41 小黑盒一级链接全流程；.42 的缩放修复和断网自动打开离线副本；.43 的两项修复（离线短链保存、卸载窗口清理）；.46 的手机版与缩放留白修复；.47 手机版下隐藏缩放；.48 更新检查超时。

---

## 3. 下一步：实机验证（最重要）

### 3.1 验证 .48

1. 安装 .48：设置页「检查并下载更新」→ Decky「从 ZIP 文件安装插件」→ 选 `/home/deck/Downloads/UmeYc-Portal.zip`。
2. **手机版网页**：设置页打开「手机版网页」→ 当前网页刷新一次；B 站等站点应切到 `m.` 移动版。手机版下右上角缩放按钮应消失，按 L1/R1/L3 不应改变比例；关闭开关 → 恢复桌面版、刷新一次并恢复缩放按钮。
3. **缩放留白**：在 B 站/小黑盒这类整屏页面上连续点「缩小」→ 底部不应出现大片空白；点「默认」→ 恢复原样。
4. **随插件页显示**：已在 .45 实机确认（点开显示、返回收起）。
5. 联网扫码发送一篇小黑盒文章（可用短链/分享链），等待出现「离线保存完成」，不再出现「离线保存失败：等待网页加载超时」。
6. 点网页右上角缩小/默认/放大：**不应再出现 Python 异常**。
7. 关闭 Wi‑Fi，从「网页」历史点击同一个网址：应提示「已打开离线副本」并显示本地页面。
8. 在 Portal 打开时卸载/重载插件：**阅读器窗口应立即消失**；若仍残留，记录是否有 `window.portal` 及 Decky 版本。
9. **更新检查超时**：断网或 GitHub 不可达时，检查最多约 95 秒应给出失败/超时提示，按钮恢复可点；再次点击应提示「正在检查更新」而不是无反应。
10. 也可从「本地文件 → 离线网页」直接打开；删除集合时应连同 `pages/` 一起删除。

如果第 2 步失败：记录站点是否跳转到 `m.` 域名、页面是否刷新、`/home/deck/homebrew/logs/UmeYc-Portal/<时间>.log`。
如果第 3 步仍留白：记录站点和页面结构（是否为固定高度容器），必要时把 `assets/web-zoom.js` 的容器判定条件放宽。
如果第 5 步仍失败：记录提示原文、扫码发送的原始网址、页面实际停止的 URL、`/home/deck/homebrew/logs/UmeYc-Portal/<时间>.log`。
如果第 7 步仍失败：确认是从「网页」历史点击（不是旧标签）、断网后 `navigator.onLine` 是否为 false、历史 URL 与保存时的最终 URL 是否一致（短链跳转可能导致不一致）。必要时放宽 `findOfflineCollection` 的匹配或记录保存时原始 URL 的映射。
如果第 8 步仍失败：说明残留视图不是本插件创建或 onDismount 未执行；重启 Steam 可清掉，并记录 Decky 版本。

### 3.2 验证 .41 小黑盒一级链接

- 保存完成后检查集合目录：`index.html`、`assets/`、`pages/1/index.html`…、`links.json`、manifest 中 `link_pages > 0`。
- 主页正文里的小黑盒文章链接应指向本地子页；断网可点开；子页里的更深链接不递归（当前设计）。
- 删除集合确认整个目录（含 `pages/`）被清理。

### 3.3 可选后续

- 给子页面二级链接增加可选开关（默认关闭，避免抓取爆炸）。
- 若用户仍反馈断网打不开，考虑把「离线副本」入口加到网页面板标题旁，而不只依赖 `navigator.onLine`。
- 确认没问题后可删除 Deck 上的诊断文件：`/home/deck/umeyc-debug.flag`、`/home/deck/umeyc-backend-stack.txt`、`/home/deck/umeyc-update-error.txt`。

---

## 4. 新电脑环境搭建

### 4.1 依赖

- **Node.js ≥ 22**（`.nvmrc` 为 22）、**pnpm 9**、**Python ≥ 3.9**、git。
- 旧机没有全局 `pnpm`，统一用 `corepack pnpm@9.15.9 ...`。新机可以 `corepack enable` 后直接用 9.15.9。
- 第一次拉代码后安装依赖（`node_modules` 特意没打进交接包）：

```bash
corepack pnpm@9.15.9 install --frozen-lockfile
```

### 4.2 常用命令

```bash
corepack pnpm@9.15.9 lint
corepack pnpm@9.15.9 exec tsc --noEmit
corepack pnpm@9.15.9 test:coverage
corepack pnpm@9.15.9 build          # 生成 dist/
python scripts/package.py           # 生成 out/UmeYc-Portal.zip
```

Python 测试（Windows 建议只跑这些；Linux/Deck 可跑全量）：

```bash
python -m unittest tests.test_web_scroll tests.test_web_capture tests.test_mhtml_bundle \
  tests.test_offline_store tests.test_storage_migration tests.test_update_checker -v
```

Windows 上 `tests.test_local_files` / `test_local_library` / `test_phone_input` / `test_image_upload` 中依赖 `os.geteuid()` 和 POSIX 权限的用例会失败，属平台差异。

### 4.3 git / GitHub

- 仓库已带完整 `.git`（含所有分支/tag），解压即可 `git log`、`git tag`。
- 需要重新认证 GitHub：`gh auth login`，并确认 `gh repo view ChongChongCoda/UmeYc-Portal` 正常。
- 当前机器推 GitHub 需要代理：`https_proxy=http://127.0.0.1:7897 git push ...`；新机按自己的网络情况设置，不一定要代理。
- `gh` 在双远程仓库里可能默认解析到上游 `xiaochaom`，发布时务必加 `--repo ChongChongCoda/UmeYc-Portal`。

### 4.4 Claude 记录恢复（可选）

交接包 `docs/handoff/memory/` 里有本项目相关的 Claude 记忆文件：

- `umeyc-portal-offline-fork.md`：项目进度、地址、坑。
- `github-network-proxy.md`：旧机 GitHub 代理经验。

可以放到新机 `~/.claude/projects/<项目路径编码>/memory/`，并在同目录 `MEMORY.md` 加一行；也可以不安装，直接让 Claude 读这两个 Markdown。

---

## 5. 构建与发布流程

### 5.1 版本号

- `package.json` 的 `version`：如 `1.0.0-zh-cn.48`。
- `README.md` 的「当前版本」同步更新。
- `plugin.json` **没有** version 字段，不要加。
- `scripts/package.py` 使用 `plugin.json` 的 `name` 作为 ZIP 名。

### 5.2 发版

```bash
# 1. 改版本号、测试、构建、打包
corepack pnpm@9.15.9 lint
corepack pnpm@9.15.9 exec tsc --noEmit
corepack pnpm@9.15.9 test:coverage
corepack pnpm@9.15.9 build
python scripts/package.py

# 2. 提交 + tag
git add -A
git commit -m "…"
git tag fork-1.0.0-zh-cn.48

# 3. 推送（旧机需要 https_proxy；新机直连可用）
git push origin main
git push origin fork-1.0.0-zh-cn.48

# 4. 创建 Release（注意 --repo，默认可能解析到上游）
#    新机 gh 不在 PATH：export PATH="/c/Program Files/GitHub CLI:$PATH"
gh release create fork-1.0.0-zh-cn.48 out/UmeYc-Portal.zip \
  --repo ChongChongCoda/UmeYc-Portal \
  --title "UmeYc-Portal 1.0.0-zh-cn.48" --latest \
  --notes "更新说明…"
```

验证最新 Release：

```bash
curl -s https://api.github.com/repos/ChongChongCoda/UmeYc-Portal/releases/latest
```

`gh release list` 在旧机曾出现只列出老版本的情况，以 API / 网页为准。

### 5.3 `package.py` 的文件白名单

`scripts/package.py` 里有一个 `required` 列表。**新增 Python 模块或 `assets/` 必需文件时必须加进去**，否则打包出的 ZIP 缺文件、Deck 上后端导入失败。

---

## 6. 架构与文件地图

### 6.1 后端（Python）

| 文件 | 作用 |
| --- | --- |
| `main.py` | Decky `Plugin` 入口、所有 callable、保存任务、迁移、更新检查、启动离线服务。**绝不能把内部属性命名为 `_migration` / `_uninstall` 等保留钩子。** |
| `web_capture.py` | CDP 抓取：等待页面、懒加载预滚、MHTML 快照、失败退化为整页截图、小黑盒一级链接抓取、href 改写与恢复。 |
| `mhtml_bundle.py` | MHTML → 无脚本静态目录：资源落地、相对路径改写、CSS 处理、`rewrite_page_links`。 |
| `web_scroll.py` | 通过 CDP 发原生滚轮/按键/缩放；页面匹配（标题→URL→同路径→唯一网页）；视频全屏按键；`set_mobile_mode` 设置手机 UA/触摸/移动视口并刷新。 |
| `offline_store.py` | 离线集合 manifest、列表、token 授权、删除。 |
| `offline_server.py` | loopback 只读静态服务，路径穿越/符号链接防护，CSP 禁脚本。 |
| `phone_input.py` | 手机扫码接收服务（网址/图片/纯文本搜索），5 分钟会话、随机 token。 |
| `local_app.py` | 本地地图册只读服务（默认端口 8137），允许同源脚本，注入触屏手势层。 |
| `update_checker.py` | GitHub Releases 检查、证书/代理处理、ZIP 校验、下载并替换旧 ZIP。 |
| `storage_migration.py` | 图片/离线网页位置迁移。 |
| `image_upload.py` | 手机上传图片接收、保存位置。 |
| `local_library.py` | 本地文件列表/授权。 |

### 6.2 前端（TypeScript/React）

| 文件 | 作用 |
| --- | --- |
| `src/components/portal-view.tsx` | BrowserView 生命周期、导航、URL/标题轮询、离线快照期间隐藏、断网自动打开离线副本。 |
| `src/components/settings.tsx` | QAM 设置、更新按钮/提示、地图搜索入口。 |
| `src/components/web-header.tsx` | 网页标题栏、缩放按钮、地图「搜索」按钮。 |
| `src/components/map-search-modal.tsx` | Steam 键盘搜索（`SteamKeyboardSearch`）及手机扫码兜底。 |
| `src/lib/steam-keyboard.ts` | 获取 `VirtualKeyboardManager`：优先 `SteamUIStore.GetFocusedWindowInstance()`，再主窗口/路由。 |
| `src/components/local-files-modal.tsx` | 本地文件、离线网页、地图册、迁移 UI。 |
| `src/components/phone-url-modal.tsx` | 扫码传送 UI，触发自动离线保存。 |
| `src/lib/offline.ts` | 保存状态轮询、离线集合列表/打开/删除、断网查找 `findSavedOfflinePage`。 |
| `src/lib/updates.ts` | 更新检查 callable 与本地存储键。 |
| `src/lib/web-mobile.ts` | 手机版网页开关的存储键与 `set_web_mobile_mode` callable。 |
| `src/lib/url-history.ts` | 最近浏览/标题持久化。 |

### 6.3 数据布局

- 默认保存位置：有 SD 卡时 `…/UmeYc-Portal/uploads`，否则 `~/Pictures/UmeYc-Portal`；可手动选择。
- 每个离线集合一个目录：
  - `manifest.json`
  - `index.html`（主页面，已去脚本）
  - `assets/`（主页面资源）
  - `pages/<n>/index.html` + `pages/<n>/assets/`（一级链接子页）
  - `links.json`（链接列表和保存结果）
- 更新包：`~/Downloads/UmeYc-Portal.zip`（固定覆盖）。

### 6.4 localStorage 键

`portal`（主状态）、`portal.uploadDirectory`、`portal.offlineAuto`、`portal.mobileWeb`、`portal.urlHistory`、`portal.urlHistoryTitles`、`portal.localAppDirectory`、`portal.localAppEntry`、`portal.updateCheckedAt`、`portal.updateReady`、`portal.updateError`。

---

## 7. 已知坑（务必先看）

1. **Decky 保留钩子**：`Plugin._migration` / `_uninstall` / `_main` / `_unload` 会被 Decky 启动时调用。内部属性绝不能叫 `_migration`（曾导致 `NoneType not callable`，后端完全无响应）。
2. **Decky 日志路径**：`/home/deck/homebrew/logs/UmeYc-Portal/<时间>.log`。插件 stdout 可能卡在管道，日志文件更可靠。
3. **自动更新 TLS**：Decky Python 可能报 `CERTIFICATE_VERIFY_FAILED`，且本机 hosts/代理可能把 `github.com` / `api.github.com` 解析到 `127.0.0.1`。`update_checker.py` 已显式加载 certifi + 系统 CA，并保留无代理直连重试；失败写 `/home/deck/umeyc-update-error.txt`。
4. **Steam 键盘**：必须用非模态 `ShowVirtualKeyboard()`（`ShowModalKeyboard` 出现过黑色空键盘）；优先 focused window 的 manager。中文 IME 提交走 `onTextEntered`；Enter 标签由 `strEnterKeyLabel` 设置。顶部输入条要用固定宽度原生按钮，Decky `DialogButton` 默认全宽会把文字挤成竖排。
5. **页面识别**：Steam BrowserView 的 `URL/Title` 可能滞后。`.42` 的 `_matching_pages` 依次尝试标题→完整 URL→同路径→唯一非 Steam 网页；修改时保留这些回退和回归测试。
6. **离线与历史**：历史保存的是原始网址。`.42` 在断网时自动替换为离线副本，但依赖 `navigator.onLine === false` 且最终 URL 与集合 `url` 匹配（忽略末尾 `/` 和 `#fragment`）。短链跳转后历史同步到最终 URL，一般能匹配。
7. **扫码**：手机和 Deck 必须同一 Wi-Fi；访客隔离/VPN 会影响。二维码 5 分钟过期。
8. **地图册**：只读引用，不复制；需要 WebGL 支持 3D；页面自带输入框只读，搜索用顶部按钮。
9. **Windows 测试差异**：POSIX 权限/`geteuid` 用例会失败；以 Linux/Deck 或针对性模块为准。
10. **构建工具**：本机 `pnpm` 不在 PATH，用 `corepack pnpm@9.15.9`；PowerShell 里注意引号。
11. **打包白名单**：见 5.3。
12. **GitHub 推送**：旧机需要 `https_proxy=http://127.0.0.1:7897`；`gh` 默认仓库可能解析到上游，发版加 `--repo`。

---

## 8. 版本演进（问题 → 修复）

- `.33` 地图搜索/缩放修正；`.34` 手机扫码搜索（体验差，被否决）。
- `.35` 模态 Steam 键盘出现黑色空键盘；`.36` 改非模态 + focused manager。
- `.37` 自动更新首次失败；`.38` 错误改为数据返回 + 诊断文件 + 无代理重试；`.39` 加载系统 CA，实机成功。
- `.40` 键盘输入条布局修复（固定宽度、横向）。
- `.41` 小黑盒一级文章链接离线抓取（`/app/bbs/link|post/`，最多 30，子页不递归）。
- `.42` 缩放页面识别回退；断网从历史自动打开离线副本；完成提示/文档补充。
- `.43` 实机反馈两项修复：扫码短链跳转导致离线保存匹配超时（`_matching_pages` 增加「唯一非 Steam 网页」回退）；插件卸载/重载后阅读器窗口残留（onDismount 主动 Destroy + 清理上一实例的 `window.portal`）。
- `.44` 曾加入标题栏「收起」+ 左上角「攻略」悬浮按钮；用户否决悬浮按钮。
- `.45` 改为随插件页显示：`titleView` 标记检测当前是否在插件页，返回插件列表即收起；移除 `collapsed` / `manualVisible` 与悬浮按钮。
- `.46` 新增设置页「手机版网页」（Android UA + 触摸 + 移动视口，切换时刷新）；修复缩小时固定高度页面底部留白（`web-zoom.js` 拉伸整屏容器）。
- `.47` 手机版开启时隐藏/禁用网页缩放（前端按钮、L1/R1/L3 与后端 `zoom()`），避免 CSS zoom 破坏移动版比例；关闭手机版恢复。
- `.48` 更新检查增加 75/95/110 秒三层超时与非阻塞锁，修复「一直显示正在检查」；检查中再次点击会提示等待。

---

## 9. 交接包内容与排除项

**包含**：全部源码、测试、文档、`dist/`、`out/UmeYc-Portal.zip`、完整 `.git`（历史与 tag）、`docs/handoff/`（本文件引用的记忆快照）、`HANDOFF.md`。

**排除**：

- `node_modules/`（243 MB，运行 `corepack pnpm@9.15.9 install --frozen-lockfile` 重建）
- `coverage/`（测试报告）
- `__pycache__/`、`.pytest_cache/` 等缓存
- Deck 本机的诊断文件、日志、二维码会话/令牌等运行时数据

没有包含任何账号密码或 GitHub token。发布前请在新机自行 `gh auth login`。

---

## 10. 给接手的 Claude 的开工提示

1. 按 `README.md` 顶部的顺序：`README.md` → `HANDOFF.md` → `CLAUDE.md` → `docs/OFFLINE_CAPTURE_VERIFICATION.md`。
2. `git log -10`、`git tag --sort=-creatordate | head` 确认上下文。
3. 先跑 `corepack pnpm@9.15.9 install --frozen-lockfile` 和 `corepack pnpm@9.15.9 test:coverage`，确认基线。
4. 优先向用户确认第 3 节实机验证结果，再决定改哪里；不要在未确认的情况下大改离线/更新逻辑。
5. 发版必须更新 `package.json` + `README.md` 版本号，并同步 Release；保持「只下载不自动安装」的产品约束。
