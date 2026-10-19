# Design: DSH 宿主插件接管推送与作答

## 决策 1：进程内（A 路径），不走 `/api/remote.mux`

两条备选：**A** 用 `ctx.userQuestions` seam 在进程内做；**B** 把已验证的外部桥（WS `$events` + RPC）
原样搬进插件。选 A：B 仍要 cookie（每次重启变）、WS 断线重连、以及"本机 Web 必须在线"，
而这些正是外部桥此前出故障的地方；A 没有网络依赖，已有的 relay 只当"手机侧的邮局"。

代价（已知并记录）：A 拿不到 `$events/result` 那条"直接认领浏览器端 waterfall 事件"的能力，
所以解释见决策 2。

## 决策 2：前台作答权留给 Web UI，手机答案走 `continued` 路由

`dsh-user-questions` 只有两条作答路径（源码读出）：

| 问题状态 | 唯一可行路径 |
|---|---|
| `open`（前台工具调用还挂着） | 只能由认领**同一 waterfall** 的 answerer 返回 `{answers}` |
| `continued`（等待已结束） | `ctx.userQuestions.answer(活根 agent, callId, {answers})` |

插件默认 `claimForeground: false`：监听器 prepend 后 `return next()`，浏览器在线时体验与现状一致。
手机答案因此只在问题变成 `continued` 后才能落地——所以：

- **窗口期内到达的答案"扣着不丢"**：`answer()` 返回 `false` 时不 ack，留在 relay 队列里下一轮重试；
  只有投影 `settled` 里明确出现该 callId 才丢弃。
- 投影状态是 `{ timed, questions: { active, settled } }`（**嵌套在 `questions` 下**）。
  早期版本少读一层 `questions` 得到 `undefined`，把"仍在等待"的问题当成"已结束"而静默 ack 掉答案——
  这条已修，并作为回归项写进 `plugin-selftest.mjs`。
- `claimForeground: true` 是实验开关：把问题挂在 waterfall 上、手机答案与 UI 答案赛跑，legacy 模式也能答，
  代价是与 UI 抢答权。

## 决策 3：手机作答必须 `tool-ask-user: mode: timed`

`askTimed()` 才会写 `wait = { callId, timed: true }`，而**只有这个形状**会 fold 进会话投影；
`mode: legacy`（三个 profile 的出厂默认，实测 2026-10-12）下 `wait = { callId }`、投影永远空，
`answer()` 恒为 `false`。插件的行为：

- 每个问题都打 `timed=`；
- `timed === false` 的答案**明确拒绝并 ack 掉**（日志说明"只有 Web UI 能答"），不静默丢、不无限重试。

## 决策 4：三个触发点（对应旧 hook 的逐项等价物）

| 旧 hook | 插件 |
|---|---|
| `PreToolUse` 提问推送 | `user-questions/request` waterfall（prepend，拿到服务词汇表 + `timed`）|
| 同上兜底 | `tools/pre-execute`（waterfall 被"后 prepend 的作答器"抢位时仍能通知）|
| `PostToolUse` 回声 | `tools/post-execute`（`{pending:true}` 不回声）|
| `Stop` 结束推送 | `agent/turn-stopping`（按 `session:turn` 去重）|

**竞位事实**（实测）：`prepend` 是"后注册者排最前"。同进程再装一个也 prepend 的作答器（如
`@probe/dsh-uq-probe` 的 autoAnswer）时，它会排到插件前面，直接返回答案而不调 `next()`，
**waterfall 监听器一次都不会执行**。所以必须有 `tools/pre-execute` 兜底；两个触发点按 `exec.callId`
去重，正常只推一次，且 waterfall 那次会把 `timed` 校正进登记表。

## 决策 5：relay 只做队列，不做回调

主机常年在 NAT 后面，relay 无法回连。契约：`/answer/host` 开号（签发 `hk_`）、
`/answer/register` 带 `hostId` 入队、`/answer/pending` 主机轮询、`/answer/ack` 确认。
于是"手机已作答"的语义 = `queued: true`，真正生效在主机下一轮轮询（≤3 s）。

**轮询必须让 URL 唯一**：实测同一 URL 反复 GET 会一直拿到第一次的响应（宿主 fetch 链路缓存），
表现为"relay 队列明明在长、插件反复处理最早那一条"。加 `&_=<毫秒时间戳>` 后立刻正常。

## 决策 6：推送载荷按 App 既有语法逐字复刻

不新增字段、不改语义：提问 `priority 4` + `📱 作答: <base>/answer/<callId>` + `#qid` / `#opts qid=a|b|c`
（仅单问题 2–3 选项且标签不含 `|=#`）+ `#web` + `#name`；结束 `priority 3` + `目录: <cwd>`；
回声 `priority 1` + `#ans <callId> <摘要>`（空摘要回落 `已作答`）。
App 侧因此**不需要任何改动**，"功能一致"的判断标准就是：同一 topic 上收到的字节级语法相同。

## 风险与已处置

| 风险 | 处置 |
|---|---|
| 插件未知/缺配置拖垮宿主启动 | 全部字段带默认值；缺 `host` 或 `hostToken` 时只当透明监听器并打一行日志 |
| 推送失败阻塞任务 | 全部推送 fire-and-forget；`tools/post-execute` 立刻 `return next()`（对工具链透明） |
| 与 hook 双推 | 文档写明二选一；本变更不动存量 hook |
| 答案丢失 | 只有"投影确认 settled"或"legacy 明确不可答"才 ack；其余留在 relay 队列（TTL 1 h）重试 |
| 令牌泄漏 | 只从环境变量读（`DSH_PUSH_HOST_TOKEN` / `_REG_TOKEN` / `_NTFY_TOKEN`），YAML 只放 topic/host |

## 验收证据（2026-10-12）

- 挂载：`--from-default-profile headless` 新建 `pushtest` → `plugin add link:…/host-plugin` →
  `--dump-config` 尾部 `# == dsh-push-host` / `- id: push-host`。
- 通知层 + 作答层（真 agent、真 relay、真 ntfy）：真 agent 用 timed 工具提问 → ntfy 收到提问卡（含
  `#qid`/`#opts`/`#name`）→ 窗口期内从手机侧 `curl /answer/submit` → 插件 `not answerable yet (state=open)`
  扣住 → 60 s 后 `answered (continued)` → agent 最终回复承认收到 "second"。
- 结束推送 + 回声：另一轮真 agent 运行中收到 `DSH 任务结束 [1150afd5]`（`目录: …` + `#name`，priority 3）
  与 `DSH 已答` + `#ans <callId> first`（priority 1）。
- 纯逻辑：`node plugin-selftest.mjs` → `48/48 checks passed`。
