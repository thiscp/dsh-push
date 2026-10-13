# dsh-host-plugin — 变更规格（dsh-push-web-link-out-of-box）

## MODIFIED Requirements

### Requirement: 提问推送（宿主插件路径）

插件 SHALL 在 `user-questions/request` waterfall 上以 prepend 认领每个待答问题，向该主机配置的 ntfy
topic 发布 priority 4 的通知，并 SHALL 向 answer-relay 以 `callId` + `hostId` 注册该问题；随后 SHALL
调用 `next()` 把前台作答权交还下游（DSH Web UI）。推送正文 SHALL 沿用 App 既有语法：
`📱 作答: <answerBase>/answer/<callId>`、`\n#qid <首问id>`、单问题 2–3 选项时追加
`\n#opts <qid>=<a|b|c>`、追加 `\n#web <url>`——配置了 `webBase` 时 SHALL 用 web.log 里最后一个
`?token=` 拼到该基址上，未配置 `webBase` 时 SHALL 回退为 web.log 里 DSH 自己打印的最后一条完整
URL（v0.1.1，开箱即有网页入口；可达性等同 DSH 实际绑定地址的可达性），web.log 读不到或无
token 行时 SHALL NOT 追加 `#web`；配置了实例名时追加 `\n#name <名>`。
同一 `callId` SHALL 至多推送并注册一次。

#### Scenario: 选择题提问

- **WHEN** agent 通过 `ask_user_question`（timed 模式）提出单选问题并等待
- **THEN** ntfy 收到 priority 4 通知，正文含问题文本、`→ 选项` 行、作答链接、`#qid`、`#opts`、`#name`，且 relay 中该 `callId` 归属本 host

#### Scenario: 计划审批类提问

- **WHEN** 计划审批走同一问题 seam（`intent.kind = plan-review`）
- **THEN** 插件按同一语法推送该问题与其选项，无需按工具名白名单

#### Scenario: 触发点兜底

- **WHEN** 另一个也以 prepend 注册的作答器排到插件之前并直接返回答案（未调用 `next()`），waterfall 监听器不执行
- **THEN** `tools/pre-execute` 兜底触发同一 `callId` 的推送与注册，用户仍收到通知

#### Scenario: 未配 webBase 也带网页入口（v0.1.1）

- **WHEN** 主机未配置 `webBase`，web.log 里存在 DSH 打印的 `dsh web: http://<addr>:<port>/?token=…` 行
- **THEN** 推送正文仍追加 `#web`，值为 web.log 里**最后一条**完整 URL（手机能否打开取决于该地址可达性）；web.log 缺失或无 token 行时才不带 `#web`

### Requirement: 轮次结束推送（宿主插件路径）

插件 SHALL 在 `agent/turn-stopping` 时向该主机 topic 发布 priority 3 的通知，标题 SHALL 含会话标识尾部，
正文 SHALL 含 `目录: <cwd>`，并 SHALL 按与提问推送相同的 `#web` 规则（配置基址则拼基址，未配置则
回退 web.log 最后一条 URL，读不到则不带）与实例名规则追加 `#web` 与 `#name`；同一 `session:turn`
SHALL 至多推送一次；推送 SHALL 以 fire-and-forget 方式发出，失败 SHALL NOT 阻塞轮次结束。

#### Scenario: 一轮结束

- **WHEN** 一个 agent 轮次停止
- **THEN** 推送到达，标题为 `DSH 任务结束 [<sess8>]`，正文首行 `目录: <cwd>`

#### Scenario: 同轮重复事件

- **WHEN** 同一轮次的停止事件再次触发
- **THEN** 不再推送第二条

#### Scenario: 推送不可达

- **WHEN** ntfy 不可达或超时
- **THEN** 仅记录日志，轮次正常结束

## ADDED Requirements

### Requirement: 配对载荷可携带网页入口字段

`dsh-push-pair payload` SHALL 支持 `--web-base <url>` 与 `--web-name <名>`；两者已知时 SHALL 以
`webBase`/`webName` 字段写入载荷 JSON（存成凭据文件后插件即按上述规则带 `#web`/`#name`）。
两者未知时载荷 SHALL 与 `deploy/relay-user-add.sh` 的输出逐字同构（`v`=1、同样 7 个必填字段、
同样字段顺序，MUST NOT 出现空占位），必填字段缺失判定与拒绝输出行为 SHALL 不变。
`relay-user-add.sh` MUST NOT 输出这两个字段（它不知道用户的网络，只有跑配对命令的人知道手机
该拨哪个地址）。

#### Scenario: 带参数配对

- **WHEN** 运行 `dsh-push-pair payload --web-base http://100.x.y.z:3080 --web-name 我的机器`
- **THEN** 输出 JSON 在 7 个必填字段之外含 `webBase` 与 `webName`，其余字段与不带这两个参数时一致

#### Scenario: 不带参数（老载荷不变）

- **WHEN** 运行 `dsh-push-pair payload`（凭据文件里没有 webBase/webName）
- **THEN** 输出 JSON 恰为 7 字段 + `v`，不含 `webBase`/`webName` 键
