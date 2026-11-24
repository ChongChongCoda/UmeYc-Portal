---
name: github-network-proxy
description: "github.com is intermittently unreachable on this machine; use https_proxy or a ghfast.top mirror for release downloads"
metadata: 
  node_type: memory
  type: reference
  originSessionId: d39fbb6d-c938-498c-8ca5-8949370cac5d
  modified: 2026-11-23T01:12:24.928Z
---

On this Windows machine, `github.com` HTTPS is unreliable (intermittent timeouts / TLS errors). `raw.githubusercontent.com`, `api.github.com`, `codeload.github.com` and `gitee.com` are reachable.

A local proxy listens on `http://127.0.0.1:7897` (Clash-style default port; 7890 is closed).

**Only the `https_proxy` environment variable makes `git clone` to github.com work:**

```bash
https_proxy=http://127.0.0.1:7897 git clone https://github.com/owner/repo <dir>
```

These do NOT work for cloning github.com:
- `git -c http.proxy=http://127.0.0.1:7897` → `TLS connect error: ... unexpected eof`
- `GIT_CONFIG_KEY_0=http.proxy` env config → same TLS error
- SSH (`git@github.com:`) → `Permission denied (publickey)`, no keys configured

**Why:** the sandbox/harness `claude` CLI does not inherit `https_proxy` into its subprocess git calls, so `claude plugin marketplace add owner/repo` fails even when the shell has a working proxy.

**How to apply:** to install a Claude Code plugin from GitHub, clone manually with `https_proxy` set, then register the local path:
`claude plugin marketplace add 'C:\Users\USER\.claude\plugin-sources\<repo>'` → `claude plugin install <plugin>@<marketplace>`. Caveat: this makes it a local-path marketplace, so updates need `git -C <src> pull` instead of `claude plugin marketplace update`. See [[i-have-adhd-plugin]].

## 2026-11-23 实测更新

- `api.github.com` **直连可用**（返回 200），不需要代理。
- `github.com` 的 release 下载（重定向到 `objects.githubusercontent.com`）**直连失败**（5~20 秒后 connect timeout），代理 `127.0.0.1:7897` 当时未监听（FlClash 的 helper 服务占的是随机端口，不再固定 7897）。
- 可用做法：用镜像前缀下载 release 资产，实测 `https://ghfast.top/<原始 github URL>` 返回 206 正常；`gh-proxy.com`、`ghproxy.net` 也可用，`github.moeyy.xyz` 不通。
- 例：`curl -fsSL -o fzf.zip "https://ghfast.top/https://github.com/junegunn/fzf/releases/download/v0.75.0/fzf-0.75.0-windows_amd64.zip"`。
- 同一台机器设置了 `NoDefaultCurrentDirectoryInExePath`：cmd 里运行当前目录的 .bat 必须用 `.\foo.bat`，只写 `foo.bat` 会报「不是内部或外部命令」。
