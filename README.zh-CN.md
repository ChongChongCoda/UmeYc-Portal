# Portal 简体中文版

基于 ajustinjames/decky-portal 官方稳定标签 v0.1.1（023cc39efb1004797291d2269e07fca72def4dba），安装版本标记为 1.0.0-zh-cn.2。保留 BSD-3-Clause 许可证及上游提交历史。

汉化了设置、位置选项、大小与边距、网址对话框、控制栏及最小化提示。插件内部名称仍为 Portal，网页本身的内容由网站提供。

使用：按 Steam Deck 的「…」键，进入 Decky → Portal。选择「网址」，输入攻略网页或图片地址；用「位置」「大小」「边距」调整悬浮窗，「展开」查看大图，「关闭」收起窗口。

本地攻略：在游戏模式中选择 **「本地文件」**，用 Decky 自带的手柄文件选择器浏览 SD 卡或内置存储。首次从 `/run/media` 开始（SD 卡通常位于其中的 `deck` 目录），以后记住上次打开的目录。支持 JPG/JPEG、PNG、GIF、WebP、BMP、SVG、AVIF、ICO、PDF、HTML、TXT、MD。大小写后缀均可。

图片默认适合窗口宽度，可触屏上下滚动长图；顶部的「−」「＋」「适宽」用于缩放。按 Portal 的「展开」可以在更大的区域阅读。选错文件或取消选择不会替换当前页面。通过 Steam 浏览器交互时可使用触屏，或按住 STEAM 键使用右触控板和扳机模拟鼠标。

本地预览由插件自己的 Python 标准库服务提供，仅监听 `127.0.0.1` 的随机端口；只有明确选中的文件会获得临时预览地址，不开放目录浏览。插件卸载或重载会停止服务；保存的是本地路径，重新打开时自动生成有效地址。拔出 SD 卡后需要插回同一张卡或重新选择文件。HTML 仅支持单文件内容，脚本受限，不提供相邻资源目录访问。

安装：在 Decky 设置中选择「从 ZIP 文件安装插件」，选择 `Portal.zip`（也可使用重命名的 `Portal-zh-CN.zip`）。从旧版升级会保留原来的位置和大小设置。

从源码构建（Node >=22、pnpm >=9、Python >=3.9）：

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm format:check
pnpm exec tsc --noEmit
pnpm test
python3 -m unittest discover -s tests -v
pnpm build
python3 scripts/package.py
```

安装包生成在 `out/Portal.zip`。也可使用 `pnpm deck:build` 通过 Docker 构建。安装包必须包含 `main.py` 和 `assets/image-viewer.html`，不要只复制前端 `dist`。

回退：在 Decky 的插件管理中卸载 Portal，或安装原版 ZIP。以后安装官方更新可能覆盖这份汉化。

本分支源码仓库：<https://github.com/xiaochaom/UmeYc-Portal>。
