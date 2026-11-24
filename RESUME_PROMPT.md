# 新电脑继续工作：给 Claude 的开场提示

解压交接包后，用 Claude Code 打开 `UmeYc-Portal` 文件夹，发送下面这段即可：

```text
先读 HANDOFF.md、CLAUDE.md 和 README.md，再跑 git log -10 了解当前状态。
这是 Steam Deck Decky 插件 UmeYc-Portal 的 fork，当前版本 1.0.0-zh-cn.42。
先帮我确认新电脑环境并恢复依赖：
1) corepack pnpm@9.15.9 install --frozen-lockfile
2) corepack pnpm@9.15.9 exec tsc --noEmit
3) corepack pnpm@9.15.9 test:coverage
然后按 HANDOFF.md 第 3 节，和我一起做实机验证：
- .42：扫码传送后网页缩放按钮不再报错；断网后从「网页」历史重开同一网址会自动打开离线副本。
- .41：小黑盒一级文章链接抓取、子页断网可看、删除集合清理 pages/。
不要改离线/更新逻辑之前先问我实机结果；发版保持「只下载不自动安装」。
```

如果只想先构建一个可安装的 ZIP：

```bash
corepack pnpm@9.15.9 build
python scripts/package.py
```

产物在 `out/UmeYc-Portal.zip`；交接包里也放了一份 .42 的现成 ZIP。
