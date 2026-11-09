# answer-relay Specification

## Purpose
定义答案回传通道（阿里云 answer-relay 服务 + 工作机 dsh-answer-bridge 桥接进程）的行为：问题注册、公网作答网页、经 Tailscale 向桥接转发并由桥接注入 DSH Web。

## Requirements

### Requirement: 问题注册
answer-relay SHALL 接受推送脚本按 callId 的问题注册（携带注册令牌），保存问题文本与选项以供作答页渲染。

#### Scenario: 提问即注册
- **WHEN** 提问推送发出时推送脚本注册 `{callId, agentId, questions[]}`
- **THEN** 返回 200，`GET /answer/<callId>` 立即可渲染该问题

#### Scenario: 未注册即访问
- **WHEN** 访问未注册或已过期 callId 的作答页
- **THEN** 返回 404 并提示改在网页端作答

### Requirement: 公网作答页
answer-relay SHALL 对 `GET /answer/<callId>` 返回移动端可用的作答页（每题渲染选项按钮与自由输入框），提交到 `POST /answer/submit`。

#### Scenario: 手机点推送链接作答
- **WHEN** 用户手机打开推送中的作答链接并选择一个选项提交
- **THEN** 页面显示「已送达，任务继续」

### Requirement: 答案转发到桥接
有效答案 SHALL 携带桥接令牌 POST 到最近接入主机的 dsh-answer-bridge（经 Tailscale 或公网入口）；桥接 SHALL 优先用事件流登记的 eventId 走 `$events/result`（open 态），失败时回退 `userQuestions/answer`（continued 态），使任务继续；注册表未命中该 agentId 时 SHALL 转发上游主机桥接并原样回传其响应。

#### Scenario: 端到端
- **WHEN** 手机经公网提交有效答案且问题仍在等待
- **THEN** 桥接注入应答，agent 收到答案继续执行

#### Scenario: 桥接不可达
- **WHEN** 转发超时或连接失败
- **THEN** 返回 5xx 并说明转发失败，页面提示错误

#### Scenario: 无对应事件
- **WHEN** 提交的 callId 在桥接无待答事件（如已作答或纯演练）
- **THEN** 返回 4xx 且任务不受影响

#### Scenario: 跨主机路由
- **WHEN** 答案的 callId 属主机不在本桥接事件流登记（agentId 未命中）
- **THEN** 请求带桥接令牌转发上游桥接，上游的 2xx/4xx 原样回传，本桥接不注入

### Requirement: 一次性语义
成功送达的答案 SHALL 立即失效，重复提交不再产生第二次注入。

#### Scenario: 重复点击提交
- **WHEN** 同一 callId 答案已成功送达后再次提交
- **THEN** 返回 4xx，agent 不被二次打扰

### Requirement: 旧 nonce 通道兼容
answer-relay SHALL 保留 v1 `{nonce, url}` 注册与 `POST /answer` 转发路径以兼容既有调用方。

#### Scenario: v1 注册
- **WHEN** 以 `{nonce, url}` 形式注册
- **THEN** 返回 200 且 `POST /answer` 路径行为不变

### Requirement: 作答回声
answer-relay 收到 `/answer/submit` 且转发成功后，SHALL 向 ntfy topic `dsh` 发布一条 priority=1 的静默消息，正文为 `#ans <callId> <答案摘要>`；发布失败 MUST 静默忽略，MUST NOT 影响提交响应。

#### Scenario: 网页作答回声
- **WHEN** 用户在浏览器作答页提交且转发成功
- **THEN** ntfy 出现 `#ans` 消息，订阅端（App）据此撤销对应通知并标记已答

#### Scenario: 回声失败不影响提交
- **WHEN** ntfy 发布失败（网络/凭据问题）
- **THEN** `/answer/submit` 仍返回原转发结果，无错误注入

### Requirement: 按主机排队与轮询取答

answer-relay SHALL 支持"按主机排队"的作答通道：主机经 `POST /answer/host` 开号取得 `hostToken`；
`POST /answer/register` 带 `hostId` 的问题 SHALL 在手机提交（`POST /answer/submit`）后进入该主机的答案队列并
返回 `queued: true`；主机 SHALL 能以 `GET /answer/pending?host=<hostId>` + `X-Host-Token` 取走答案，并以
`POST /answer/ack` 确认。队列条目 SHALL 带 TTL，过期自动失效。未携带 `hostId` 的问题 SHALL 继续走既有的
bridge 转发通道，行为不变。

#### Scenario: 开号签发主机令牌

- **WHEN** 主机以注册令牌调用 `POST /answer/host {host, topic}`
- **THEN** 返回该主机的 `hostToken`（`hk_` 前缀）与 topic，重复调用复用已有令牌（除非显式轮换）

#### Scenario: 手机提交入队

- **WHEN** 手机对带 `hostId` 的问题提交答案
- **THEN** 答案进入该主机队列并返回 `{"ok": true, "queued": true}`，同时按既有约定发出一条回声消息

#### Scenario: 主机取答与确认

- **WHEN** 主机以正确的 `X-Host-Token` 轮询 `/answer/pending`
- **THEN** 返回该主机队列中的条目（`callId`/`agentId`/`qids`/`answers`/`ts`）；`POST /answer/ack` 删除对应条目并返回删除数量

#### Scenario: 令牌不匹配

- **WHEN** 轮询或确认时的 `X-Host-Token` 与该 host 不匹配
- **THEN** 返回 401，不泄露任何队列内容

#### Scenario: 存量通道兼容

- **WHEN** 问题注册时未带 `hostId`
- **THEN** 手机提交仍按既有的 bridge 转发语义处理，不进入任何主机队列

### Requirement: 每主机通道隔离开号

relay 的部署侧 SHALL 提供一条命令为单个用户开通隔离通道：独立 ntfy 用户与令牌（写令牌只写、读令牌只读）、
该主题的访问控制、relay 主机条目，并输出可直接交给 App 的配对载荷。

#### Scenario: 开通一个用户

- **WHEN** 运行 `deploy/relay-user-add.sh <user> [topic]`
- **THEN** 输出 `{v, relay, host, topic, writeToken, readToken, hostToken}` 配对载荷，且该 host 的队列只能被其 `hostToken` 读取

#### Scenario: 重复开通

- **WHEN** 同一用户再次执行该脚本
- **THEN** 复用已有的 ntfy 用户与 relay 主机条目，不破坏已配对的 App
