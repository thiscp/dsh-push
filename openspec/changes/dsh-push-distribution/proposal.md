# Proposal: 宿主插件可分发 + 单用户开通（dsh-push-distribution）

## Why

`dsh-push-host` 现在只能按"仓库 + link 安装"用：装它的人必须先有本仓库，令牌必须由三个环境变量
喂进宿主进程，配对载荷只能由服务端脚本 `deploy/relay-user-add.sh` 在 relay 主机上手敲出来。
也就是说——**给一个真实用户开通**这件事，目前要求操作者同时理解仓库布局、pnpm link、宿主环境变量、
relay 服务器脚本四件事，而且没有任何一步可以在手机上动手之前自检。

这一变更把"最后一个用户之外的东西"补齐：**包能发**、**凭据能落文件**、**配对有一条命令**、
**上手前能自检**。生产切换（改 `web` profile、重启宿主、手机真机确认）不在本变更内。

## What Changes

1. **npm 分发就绪（`dsh-host-plugin` 新增"包分发"要求）**
   `host-plugin/package.json` 补齐 `repository` / `homepage` / `bugs` / `author` / `engines` /
   `publishConfig: { access: public }` / `files` 白名单；新增 MIT `LICENSE`；
   `dsh.bundle` 加 `version` 元数据（`patch` 仍是字符串，bundle 解析行为不变）。
   安装路径统一为 `dsh plugin --profile <p> add dsh-push-host`（npm）/ `… add ./<tarball>`（离线）/
   `… add link:<dir>`（开发），三者落点相同。
2. **凭据文件（`dsh-host-plugin` 新增"凭据文件"要求）**
   三个令牌可以从 `~/.config/dsh-push/credentials.json`（或 `DSH_PUSH_CREDENTIALS` / `credentialsFile`）
   读取；环境变量仍然可用且优先级最高；profile 显式配置压过文件。
   **直接吃 `relay-user-add.sh` 打印的那份配对载荷**（`writeToken`/`readToken`/`hostToken`/`relay`/`topic`），
   另接受别名、大小写与多 host 嵌套形式。**文件不存在 = 干净 no-op**（不报错、不打网络、退化为透明
   监听器）；文件坏 = 一行日志后继续。
3. **配对命令（`dsh-host-plugin` 新增"配对载荷"要求）**
   `dsh-push-pair`（`lib/pairing.mjs`）产出**与 `relay-user-add.sh` 逐字同构**的载荷
   （`v`=1、同 7 字段、同顺序）；缺字段拒绝输出。附带 `verify` 子命令：真打 relay/ntfy 做 5 项
   只读自检（凭据文件、字段完整度、`X-Host-Token`、读令牌、写令牌），让"令牌对不对"在手机上动手
   之前就能判定。
4. **App 导入路径提案（`companion-app` 新增"配对载荷导入"要求）**
   **不改 App**：只把"扫/粘一份配对载荷即完成 relay+topic+readToken 配置"写成规格，作为 App 侧
   后续实现的验收基线（当前 App 仍是手填三项）。
5. **文档**：`host-plugin/README.md` 补"分发/安装（三种方式）"、"给一个真实用户开通"、
   "凭据文件字段表与优先级"、"配对命令与自检项"、"一个用户跑起来之前的 8 条清单"。

## Out of Scope

- **不做生产切换**：不动 `profiles/web`、不重启宿主、不改 `hooks.json`、不做手机真机确认
  （那是 `dsh-host-plugin-push` 的 6.x 任务，由主控执行）。
- **不发布 npm**：只把包整到可发布并出 tarball 验证；`npm publish` 由维护者在有 npm 的机器上做。
- **不改 App 代码**、不改 relay 服务端、不改既有载荷语法（`#qid`/`#opts`/`#ans`/`#web`/`#name`）。
- 不引入新的运行时依赖（打包工具也是零依赖 Node 脚本）。

## Impact

- 变更文件：`host-plugin/package.json`、`host-plugin/LICENSE`（新增）、
  `host-plugin/lib/index.js`（配置分层与凭据注入）、`host-plugin/lib/credentials.mjs`（新增）、
  `host-plugin/lib/pairing-lib.mjs` + `lib/pairing.mjs`（新增）、`host-plugin/plugin-selftest-credentials.mjs`
  （新增）、`host-plugin/README.md`、`tools/pack-npm-tarball.mjs`（新增，本机无 npm 时造 tarball）。
- 规格：`dsh-host-plugin` 新增 3 条要求 + 扩既有"配置与凭据"要求；`companion-app` 新增 1 条要求。
- 兼容性：老部署（只给三个环境变量 + link 安装）行为不变；`--dump-config` 行内容不变
  （仍是 `- id: push-host` / `name: dsh-push-host`）。
