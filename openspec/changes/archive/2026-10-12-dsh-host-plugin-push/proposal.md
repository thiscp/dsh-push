# Proposal: DSH 宿主插件接管推送与作答（dsh-host-plugin-push）

## Why

现有链路全部在 DSH 进程**外面**：

- 提问/结束推送靠 `hooks.json` + 外部脚本（`deploy/windows/dsh-ntfy-push`），要求钩子插件经 profile patch
  mount 生效、命令按部署沙箱执行（受限令牌子进程在 session 0 必死，靠 danger-full-access 兜着）；
- 手机作答靠常驻的 `dsh-answer-bridge`，它要用 DSH Web 最后一次 `?token=` 换 cookie、开
  `/api/remote.mux` 的 `$events` 流、再调 `$events/result` / `userQuestions/answer` RPC——
  token 每次重启必变、WS 断线期间 relay 转发 502 会让手机弹「直答没递出去」（这条已实际踩到并修过）；
- 钩子只能看见 `PreToolUse` 的**工具名**（`ask_user_question` / `exit_plan_mode`），换工具名或换提问
  通道就漏；提问的选项还得从工具入参再解析一遍。

宿主插件把这条链路收进 DSH 进程内，用的是 DSH 自己的 seam：只装插件 + 配 token，
APP 侧**载荷语法与行为完全不变**（这正是"完全一致"的判据）。

## What Changes

1. **新增能力 `dsh-host-plugin`**：`dsh-push-host` 插件（`host-plugin/`，已入库）
   - 通知层：认领 `user-questions/request`（prepend）→ 推 ntfy + 按 hostId 注册到 relay → `return next()`，
     前台作答权仍归 DSH Web UI；另加 `tools/pre-execute` 兜底触发（waterfall 会被"后 prepend 的作答器"抢位）。
   - 作答层：`ctx.interval` 轮询 relay 的**按 host 队列**，`ctx.userQuestions.answer(活根 agent, callId, …)`
     把迟到答案灌回 agent；窗口期内的答案"扣在队列里"等它变成 `continued`，已结束的才丢弃。
   - 结束推送：`agent/turn-stopping` → `DSH 任务结束 [sess8]` + `目录: <cwd>` + `#web` + `#name`。
   - 回声：`tools/post-execute` → `#ans <callId> <摘要>`（priority 1），任意端作答都能让手机撤通知；
     `{pending:true}`（timed 等超时未答）**不回声**。
2. **relay 侧契约入库**（`answer-relay` 新增要求）：`/answer/host` 开号签发 `hostToken`、
   `/answer/register` 带 `hostId` 即入队、`/answer/pending` + `/answer/ack` 供主机取答与确认；
   不带 `hostId` 的问题继续走旧的 bridge 转发（存量不动）。
3. **规格措辞泛化**：`dsh-turn-notify`、`dsh-question-notify` 里把"Stop 钩子""PreToolUse 钩子"这类
   **实现绑定**措辞泛化为"DSH 侧实现（hook 或宿主插件）"，并补齐插件路径的场景；旧 hook 措辞里的
   场景**逐字保留**（存量部署仍按其验收）。
4. **行为修正（有意为之）**：工具返回 `{pending:true}` 时不得发 `#ans`。旧 hook 在 PostToolUse 无条件回声，
   在 timed 模式下会把"只是等超时、仍可从手机作答"的问题误置成已答、并撤掉通知。

## Out of Scope

- 不改 APP（`companion-app` 无 delta）：载荷语法、`#opts`/`#qid`/`#ans`/`#web`/`#name` 一律照旧。
- 不改 relay 的旧 nonce 通道，也不动存量 hook 部署（两条路并存；切换时须关掉 hook 的提问推送以免双推）。
- 本变更只保证"装插件 + 配 token"即可满足契约，不含把本机 `web` profile 正式切换的部署步骤。

## Impact

- 新增：`host-plugin/`（`lib/index.js`、`lib/relay.js`、`plugin-selftest.mjs`、`README.md`、`package.json`、`cordis.patch.yml`）。
- 规格：新增 `dsh-host-plugin`；修改 `dsh-turn-notify`、`dsh-question-notify`；`answer-relay` 补队列要求；
  `dsh-host-integration` 补**宿主插件**挂载与生效要求（原 hook 要求保持不动）。
- 部署前提：`tool-ask-user` 需为 `mode: timed`，否则投影不 fold、手机作答无法落地（插件会拒绝并记日志，
  不静默丢答案）。
