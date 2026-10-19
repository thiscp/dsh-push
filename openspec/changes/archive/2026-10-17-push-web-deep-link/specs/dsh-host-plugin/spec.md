## MODIFIED Requirements

### Requirement: 提问推送（宿主插件路径）

插件 SHALL 在 `user-questions/request` waterfall 上以 prepend 认领每个待答问题，向该主机配置的 ntfy
topic 发布 priority 4 的通知，并 SHALL 向 answer-relay 以 `callId` + `hostId` 注册该问题；随后 SHALL
调用 `next()` 把前台作答权交还下游（DSH Web UI）。推送正文 SHALL 沿用 App 既有语法：
`📱 作答: <answerBase>/answer/<callId>`、`\n#qid <首问id>`、单问题 2–3 选项时追加
`\n#opts <qid>=<a|b|c>`、追加 `\n#web <url>`——配置了 `webBase` 时 SHALL 用 web.log 里最后一个
`?token=` 拼到该基址上，未配置 `webBase` 时 SHALL 回退为 web.log 里 DSH 自己打印的最后一条完整
URL（v0.1.1，开箱即有网页入口；可达性等同 DSH 实际绑定地址的可达性），web.log 读不到或无
token 行时 SHALL NOT 追加 `#web`；配置了实例名时追加 `\n#name <名>`。`#web` 链接 SHALL 在已知来源
会话时以 **URL 片段**追加该会话 id（`…#session-<uuid>`，v0.2.2），使点开链接直接落到那条对话；
会话 id 缺失或不符合 `session-<uuid>` 形态时 SHALL NOT 追加片段，MUST NOT 产出以裸 `#` 结尾的链接。
用片段而非查询参数是硬约束：`?token=` 入口回的是 `303 See Other → Location: ./`，查询串在这一步
被丢弃，而片段跨跳转保留；网页客户端没有路由，路径与查询串无人解读。
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

#### Scenario: 载荷缺字段

- **WHEN** 问题缺少文本或选项
- **THEN** 正文回落 `DSH 正在等你选择` 且仍带作答链接与 `#qid`，推送照常发出

#### Scenario: 未配 webBase 也带网页入口（v0.1.1）

- **WHEN** 主机未配置 `webBase`，web.log 里存在 DSH 打印的 `dsh web: http://<addr>:<port>/?token=…` 行
- **THEN** 推送正文仍追加 `#web`，值为 web.log 里**最后一条**完整 URL（手机能否打开取决于该地址可达性）；web.log 缺失或无 token 行时才不带 `#web`

### Requirement: 轮次结束推送（宿主插件路径）

插件 SHALL 在 `agent/turn-stopping` 时向该主机 topic 发布 priority 3 的通知，标题 SHALL 含会话标识尾部，
正文 SHALL 含 `目录: <cwd>`，并 SHALL 按与提问推送相同的 `#web` 规则（含 v0.2.2 的来源会话片段；配置基址则拼基址，未配置则
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

### Requirement: 推送网页直达来源会话

插件的浏览器半（`dsh.client` 模块）SHALL 读取 `#web` 链接携带的来源会话片段，并在当前主视图不是该
会话时把主视图切到该会话（v0.2.2）。定位 SHALL 只用语义化锚点（当前会话
`[data-conversation-session]`、侧栏行 `[data-row-key="session:<id>"]`、展开侧栏
`button[aria-label="Open sidebar"]`、被折叠列表的 `Show N more sessions` 与 `aria-expanded="false"`
的工作区分组），MUST NOT 依赖哈希化的 CSS 类名。切换成功或目标已是当前会话时 SHALL 抹掉地址中的
片段（`history.replaceState`），以免用户随后手动切走、刷新时又被拽回。任何一步做不到时 SHALL 静默
放弃并在有界时间（≤20s）内停止，MUST NOT 影响页面其余部分，行为等同本能力之前。

#### Scenario: 点开推送落到来源对话

- **WHEN** 用户点开一条带 `#session-<uuid>` 片段的 `#web` 链接，而网页端主视图当前是另一个会话
- **THEN** 浏览器半展开侧栏（必要时放出被折叠的会话与分组）并选中该会话行，主视图切到该对话，地址片段被抹掉

#### Scenario: 已经在目标对话上

- **WHEN** 打开的链接片段所指会话恰是当前主视图会话
- **THEN** 不发生任何点击或跳转，仅抹掉片段

#### Scenario: 目标会话不在已加载列表里

- **WHEN** 片段所指会话在网页端已加载的会话列表中始终找不到（未加载、归档或分组无法展开）
- **THEN** 浏览器半在 ≤20s 后停止尝试并保持网页端默认落点，页面不报错、不白屏

#### Scenario: 链接不带片段

- **WHEN** `#web` 链接没有片段（旧服务端，或会话 id 形态不合），或片段不是 `session-<uuid>` 形态
- **THEN** 浏览器半不做任何事，网页端按自身记住的上一个会话打开
