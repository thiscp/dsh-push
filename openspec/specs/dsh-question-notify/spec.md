# dsh-question-notify Specification

## Purpose
定义 DSH 提问/审批待答时的推送契约：触发时机、JSON 结构化载荷与 nonce、失败隔离、去重。

## Requirements

### Requirement: 提问待答触发推送

DSH 调用 `ask_user_question`（或经同一问题 seam 的计划审批）时，主机侧实现（`PreToolUse` 钩子或宿主插件的
`user-questions/request` 监听）SHALL 向该主机配置的 ntfy topic 发布结构化提问推送。

#### Scenario: 选择题提问

- **WHEN** DSH 通过 `ask_user_question` 提问并等待
- **THEN** 推送载荷含 `event=question`、问题文本、`options[]`、`tool_use_id`、一次性 `nonce`、`web_url` 兜底链接

#### Scenario: 计划审批

- **WHEN** DSH 通过 `exit_plan_mode` 请求批准计划
- **THEN** 推送 `event=question`，选项为批准/拒绝语义

#### Scenario: 宿主插件路径

- **WHEN** 提问由宿主插件的 waterfall 监听器接管
- **THEN** 推送正文含问题文本、`📱 作答` 链接、`#qid`、单问题 2–3 选项时的 `#opts`，priority 为 4，且该问题已按 `hostId` 注册到 relay

### Requirement: nonce 注册
提问推送发布时，推送脚本 SHALL 向 answer-relay 注册该 nonce 及目标会话回调。

#### Scenario: 注册成功
- **WHEN** 提问推送发出后
- **THEN** answer-relay 持有该 nonce 到 DSH Web 会话的映射，手机可作答

### Requirement: 载荷容错
hook 载荷缺少预期字段时，推送 SHALL 降级而非丢失。

#### Scenario: 字段缺失
- **WHEN** PreToolUse 载荷中问题/选项字段不存在或结构变化
- **THEN** 仍推送兜底文案（"DSH 正在等你选择"）+ `web_url`，脚本 exit 0

### Requirement: 提问去重
同一次提问（同一工具调用 id）SHALL 至多推送一次。

#### Scenario: 钩子重复触发
- **WHEN** 同一 tool_use id 的 PreToolUse 钩子被执行多次
- **THEN** 仅第一次发布消息并注册 nonce

### Requirement: 提问推送携带网页直达链接
提问推送发布时，钩子 SHALL 从本机 DSH Web 日志现取最新 token、以配置的 tailnet 基址拼出 DSH Web 链接，并在正文追加 `\n#web <url>` 机器行；取不到 token 或未配置基址时 SHALL 省略该行且不影响推送。

#### Scenario: 链接新鲜
- **WHEN** DSH Web 刚重启（token 已变）后发出提问推送
- **THEN** `#web` 行携带重启后的新 token，手机点开即达

#### Scenario: 取不到 token
- **WHEN** DSH Web 日志缺失或无 token 行
- **THEN** 推送正常发布且不含 `#web` 行，脚本 exit 0

### Requirement: 提问推送携带首问 id
提问推送发布时，钩子 SHALL 追加 `\n#qid <首问id>` 机器行（多问题时为第一个问题的 id），使 App 在不拉取问题 JSON 的情况下也能把通知内自由文本答案提交到正确问题。

#### Scenario: 单问题
- **WHEN** 单问题提问推送发出
- **THEN** `#qid` 行含该问题 id，与 `#opts` 中的 qid 一致

#### Scenario: 多问题
- **WHEN** 多问题提问推送发出（无 `#opts`）
- **THEN** `#qid` 行含第一个问题的 id，通知自由直答默认答给首问

### Requirement: 工具结束回声

提问工具的结束时刻 SHALL 发布 priority=1 的 `#ans <tool_use_id|callId> <答案摘要>` 消息（摘要取各题
`selected[0]` 或 `custom`，" / " 连接，取不到则"已作答"），使**任意端**（含 DSH Web 聊天界面）作答后订阅端都能
撤通知入已答态；发布失败 MUST 静默。结果为 `{pending: true}`（等待超时尚未作答）时 MUST NOT 发布回声——
该问题仍可从手机作答，误发回声会把卡片错误地置为已答。

#### Scenario: 聊天界面作答

- **WHEN** 用户在 DSH Web 聊天界面点选项作答（不经 answer-relay）
- **THEN** 工具结束时钩子发出 `#ans`，手机通知消失、卡片入已答态

#### Scenario: 与 relay 回声叠加

- **WHEN** 答案经 relay 提交（relay 已发一条 `#ans`），工具结束钩子再发一条
- **THEN** 两条回声幂等，订阅端行为不变

#### Scenario: 超时未答

- **WHEN** timed 等待超时，工具返回 `{pending: true}` 且用户尚未作答
- **THEN** 不发布 `#ans`，手机卡片保持可作答（旧 hook 在此会误发，属已修正缺陷）

#### Scenario: 宿主插件路径

- **WHEN** 宿主插件在 `tools/post-execute` 看到提问工具带着答案返回
- **THEN** 插件发布 `#ans`（priority 1），且与插件自身答案落地时的回声按 `callId` 幂等
