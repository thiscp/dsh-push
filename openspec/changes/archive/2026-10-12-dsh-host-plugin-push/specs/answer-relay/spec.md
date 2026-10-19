# answer-relay 变更

## ADDED Requirements

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
