# companion-app 变更（dsh-push-distribution）

## ADDED Requirements

### Requirement: 配对载荷导入

App SHALL 支持以**一份配对载荷**完成推送通道配置，载荷 schema SHALL 与
`deploy/relay-user-add.sh` / `dsh-push-pair` 输出的对象一致：
`{v, relay, host, topic, writeToken, readToken, hostToken}`（`v` 为 1）。App 侧只使用其中的
`relay`（服务器基址）、`topic`（订阅主题）、`readToken`（订阅凭据）三项；`host` 与 `hostToken`
属主机侧、App MUST NOT 使用，`writeToken` MUST NOT 被 App 使用（只写权限，拿它也发不出通知）。
导入入口 SHALL 至少支持"粘贴 JSON 文本"，并在存在系统扫码/文件选择能力时支持"扫码"或"选文件"；
导入成功后 SHALL 写回既有配置键（ntfy 基址 / topic / 读令牌），使既有的订阅、常驻通知与通知栏
直达作答逻辑无需改动即可工作。载荷非法（非 JSON、`v` 不是 1、缺 `relay`/`topic`/`readToken` 任一项）
时 App SHALL 拒绝导入并给出可读原因，MUST NOT 写坏既有配置。

#### Scenario: 粘贴载荷完成配置

- **WHEN** 用户在 App 里粘贴一份合法配对载荷并确认
- **THEN** App 写入 relay 基址、topic 与读令牌，立即（或下一次连接时）以该 topic 订阅成功，
  随后主机发出的 `DSH 等你选择 […]` / `DSH 任务结束 […]` 通知照常到达

#### Scenario: 手填路径保持可用

- **WHEN** 用户不用导入，仍按现有方式手填基址/topic/令牌
- **THEN** 行为与导入前完全一致（导入是新增路径，不是替换）

#### Scenario: 载荷不含 App 不需要的令牌

- **WHEN** 载荷里带 `hostToken` 或 `writeToken`
- **THEN** App 忽略这两项，不落盘、不使用、不显示（避免把只写令牌或队列令牌带到手机侧）

#### Scenario: 非法载荷拒绝导入

- **WHEN** 粘贴内容不是 JSON、`v` 不是 1、或缺少 `relay`/`topic`/`readToken`
- **THEN** App 提示缺哪一项并保留原有配置不变

#### Scenario: 导入即可替换旧通道

- **WHEN** 用户从旧通道（手工配置、`topic: dsh`）导入一份新的每用户载荷
- **THEN** 新配置整体生效（同一份配置只指向一个 topic），不会同时订阅两个 topic 造成重复通知
